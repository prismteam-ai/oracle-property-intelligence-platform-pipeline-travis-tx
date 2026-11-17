import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const VOICE_MODEL = "google/gemini-3.8-flash-tts";
const VOICE = "Charon";
const DELIVERY =
  "Narrate a software demo the way a senior engineer explains it to a teammate: relaxed, warm and conversational, like talking, not reading; still clear, credible and professional. Natural rhythm and small pauses, no announcer or sales voice.";
const CHECK_MODELS = ["google/gemini-3.8-flash", "openai/gpt-audio-mini"];
const CHECK_PROMPT =
  "Transcribe this narration clip exactly, word for word. Reply with the transcript only.";
const PCM_SAMPLE_RATE = 24_000;
const PCM_BYTES_PER_MS = (PCM_SAMPLE_RATE * 2) / 1_000;
const MAX_TRANSCRIPT_DIFFERENCE = 0.08;
const PARALLEL_REQUESTS = 4;
const UNCHECKED_SUFFIX = ".unchecked.wav";
const CLOSING_MS = 2_000;
const VISIBLE_EDGE_MS = 400;
const MS_PER_SECOND = 1_000;
const SPOKEN_SCALES = { thousand: 1_000, million: 1_000_000 };
const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];
const AUDIO_BITRATE = "128k";
const VIDEO_QUALITY = "18";

const exec = promisify(execFile);

interface Clip {
  text: string;
  wav: string;
  durationMs: number;
}

interface Span {
  fromMs: number;
  toMs: number;
}

export class Narrator {
  private readonly cues: { clip: Clip; atMs: number }[] = [];
  private readonly cuts: Span[] = [];
  private startedAt = 0;

  private constructor(private readonly clips: ReadonlyMap<string, Clip>) {}

  static async prepare(lines: readonly string[], cacheDir: string): Promise<Narrator> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("Set OPENROUTER_API_KEY to narrate the demo.");
    await mkdir(cacheDir, { recursive: true });
    const clips = await inBatches(lines, (text) => voiced(text, cacheDir, apiKey));
    return new Narrator(new Map(clips.map((clip) => [clip.text, clip])));
  }

  startRecording(): void {
    this.startedAt = Date.now();
  }

  say(text: string): number {
    const clip = this.clips.get(text);
    if (!clip) throw new Error(`No narration prepared for: ${text}`);
    this.cues.push({ clip, atMs: this.elapsedMs() });
    return clip.durationMs;
  }

  async cutWaiting<T>(wait: () => Promise<T>): Promise<T> {
    const fromMs = this.elapsedMs() + VISIBLE_EDGE_MS;
    const result = await wait();
    const toMs = this.elapsedMs() - VISIBLE_EDGE_MS;
    if (toMs > fromMs) this.cuts.push({ fromMs, toMs });
    return result;
  }

  async mixInto(video: string, output: string): Promise<void> {
    const last = this.cues.at(-1);
    const endMs = last ? last.atMs + last.clip.durationMs + CLOSING_MS : 0;
    const kept = keptSpans(this.cuts, endMs);
    const segments = kept.map(
      ({ fromMs, toMs }, index) =>
        `[0:v]trim=start=${seconds(fromMs)}:end=${seconds(toMs)},setpts=PTS-STARTPTS[v${index}]`,
    );
    const joined = `${kept.map((_, index) => `[v${index}]`).join("")}concat=n=${kept.length}:v=1:a=0[video]`;
    const delayed = this.cues.map(
      ({ atMs }, index) => `[${index + 1}:a]adelay=${this.withoutCuts(atMs)}:all=1[a${index}]`,
    );
    const mixed = `${this.cues.map((_, index) => `[a${index}]`).join("")}amix=inputs=${this.cues.length}:normalize=0,apad[voice]`;
    await exec("ffmpeg", [
      ...["-loglevel", "error", "-y", "-i", video],
      ...this.cues.flatMap(({ clip }) => ["-i", clip.wav]),
      ...["-filter_complex", [...segments, joined, ...delayed, mixed].join(";")],
      ...["-map", "[video]", "-map", "[voice]", "-t", seconds(this.withoutCuts(endMs))],
      ...["-c:v", "libx264", "-crf", VIDEO_QUALITY, "-pix_fmt", "yuv420p"],
      ...["-c:a", "aac", "-b:a", AUDIO_BITRATE, "-movflags", "+faststart", output],
    ]);
  }

  private elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  private withoutCuts(atMs: number): number {
    const removed = this.cuts
      .filter((cut) => cut.toMs <= atMs)
      .reduce((total, cut) => total + cut.toMs - cut.fromMs, 0);
    return atMs - removed;
  }
}

function keptSpans(cuts: readonly Span[], endMs: number): Span[] {
  const kept: Span[] = [];
  let fromMs = 0;
  for (const cut of cuts) {
    kept.push({ fromMs, toMs: cut.fromMs });
    fromMs = cut.toMs;
  }
  kept.push({ fromMs, toMs: endMs });
  return kept.filter((span) => span.toMs > span.fromMs);
}

function seconds(ms: number): string {
  return String(ms / MS_PER_SECOND);
}

async function voiced(text: string, cacheDir: string, apiKey: string): Promise<Clip> {
  const key = createHash("sha256")
    .update([VOICE_MODEL, VOICE, DELIVERY, text].join("\n"))
    .digest("hex");
  const pcm = join(cacheDir, `${key}.pcm`);
  const wav = join(cacheDir, `${key}.wav`);
  if (!(await exists(wav))) {
    const unchecked = join(cacheDir, `${key}${UNCHECKED_SUFFIX}`);
    await writeFile(pcm, await speak(text, apiKey));
    await exec("ffmpeg", [
      ...["-loglevel", "error", "-y", "-f", "s16le", "-ar", String(PCM_SAMPLE_RATE), "-ac", "1"],
      ...["-i", pcm, unchecked],
    ]);
    await checkTranscript(text, unchecked, apiKey);
    await rename(unchecked, wav);
  }
  const durationMs = Math.round((await readFile(pcm)).byteLength / PCM_BYTES_PER_MS);
  return { text, wav, durationMs };
}

async function speak(text: string, apiKey: string): Promise<Buffer> {
  const response = await fetch(`${OPENROUTER_URL}/audio/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: VOICE_MODEL,
      voice: VOICE,
      input: text,
      instructions: DELIVERY,
      response_format: "pcm",
    }),
  });
  if (!response.ok) throw new Error(`Speech failed (${response.status}): ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

async function checkTranscript(text: string, wav: string, apiKey: string): Promise<void> {
  let transcript = "";
  for (const model of CHECK_MODELS) {
    transcript ||= await transcribe(wav, apiKey, model);
  }
  const difference = editDistance(spoken(text), spoken(transcript)) / spoken(text).length;
  if (difference > MAX_TRANSCRIPT_DIFFERENCE) {
    throw new Error(`Narration does not match its script.\nScript: ${text}\nHeard:  ${transcript}`);
  }
}

async function transcribe(wav: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch(`${OPENROUTER_URL}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      modalities: ["text"],
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: CHECK_PROMPT },
            {
              type: "input_audio",
              input_audio: { data: (await readFile(wav)).toString("base64"), format: "wav" },
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Transcription failed (${response.status})`);
  const answer = (await response.json()) as { choices: { message: { content: string | null } }[] };
  return (answer.choices[0]?.message.content ?? "").trim();
}

function spoken(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b[a-z]+\b/g, (word) => {
      const number = NUMBER_WORDS.indexOf(word);
      return number < 0 ? word : String(number);
    })
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/(\d+(?:\.\d+)?) (thousand|million)/g, (_, amount: string, scale: string) =>
      String(Math.round(Number(amount) * SPOKEN_SCALES[scale as keyof typeof SPOKEN_SCALES])),
    )
    .replaceAll("%", "percent")
    .replace(/[^a-z0-9]/g, "");
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += PARALLEL_REQUESTS) {
    results.push(...(await Promise.all(items.slice(start, start + PARALLEL_REQUESTS).map(work))));
  }
  return results;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
