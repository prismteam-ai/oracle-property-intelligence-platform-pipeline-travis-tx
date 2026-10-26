// Coming soon items (A-13 T015, PO D-7, spec US10): exactly the story's list, each with an id
// (the `/soon/:item` route), a title and one sentence. Static text only: no number, row or CID,
// and nothing that looks like data. `linked: false` items are listed in the More sheet but have
// no page (AI-user sign-in). `skeleton` names the ComingSoonSkeleton layout G3 draws.
export type ComingSoonSkeletonLayout = "list" | "map" | "chart" | "form";

export interface ComingSoonItem {
  readonly id: string;
  readonly title: string;
  readonly sentence: string;
  readonly linked: boolean;
  readonly skeleton: ComingSoonSkeletonLayout;
}

export const COMING_SOON_ITEMS: readonly ComingSoonItem[] = Object.freeze([
  {
    id: "builder-mode",
    title: "Builder mode",
    sentence: "Compose your own Explore filters and keep them as a reusable query.",
    linked: true,
    skeleton: "form",
  },
  {
    id: "other-counties",
    title: "Other counties and states",
    sentence:
      "CountyLens publishes Travis County, Texas only; other counties and states come later.",
    linked: true,
    skeleton: "list",
  },
  {
    id: "street-view",
    title: "Street View",
    sentence: "A street-level photo of each property is not part of the published data yet.",
    linked: true,
    skeleton: "map",
  },
  {
    id: "ai-user-sign-in",
    title: "AI-user sign-in",
    sentence: "Signing in to ask the CountyLens agent questions arrives with a later story.",
    linked: false,
    skeleton: "form",
  },
  {
    id: "saved-searches",
    title: "Saved searches",
    sentence: "Saving a search and coming back to it later is not available yet.",
    linked: true,
    skeleton: "list",
  },
  {
    id: "similar-properties",
    title: "Similar properties",
    sentence: "Finding properties like the selected one is not available yet.",
    linked: true,
    skeleton: "list",
  },
  {
    id: "pipeline-diagram",
    title: "Pipeline diagram and Gantt",
    sentence: "A diagram and timeline of each run's pipeline stages are not available yet.",
    linked: true,
    skeleton: "chart",
  },
  {
    id: "area-matrix",
    title: "Area matrix",
    sentence: "Comparing places side by side in one table is not available yet.",
    linked: true,
    skeleton: "chart",
  },
  {
    id: "timeline-scrubber",
    title: "Timeline scrubber",
    sentence: "Stepping through the published runs on a timeline is not available yet.",
    linked: true,
    skeleton: "chart",
  },
  {
    id: "gateway-race",
    title: "Gateway race",
    sentence:
      "Timing the same file from several public gateways side by side is not available yet.",
    linked: true,
    skeleton: "chart",
  },
]);

export function comingSoonItem(id: string): ComingSoonItem | undefined {
  return COMING_SOON_ITEMS.find((item) => item.id === id);
}
