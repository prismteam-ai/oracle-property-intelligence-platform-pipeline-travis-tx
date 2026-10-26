// ERR-39 (A-13 TC-009): the URL-controlled Filters controls (Open or stalled, Out-of-area owner, Sort)
// must show the person's choice at once, even while the URL (the caller's `onPatch`) has not committed
// yet. `onPatch` here never updates the props, which is the "navigation still pending" state.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterSheet, type FilterKey } from "../src/components/FilterSheet";

afterEach(cleanup);

function sheet(
  over: { permit?: boolean; ooa?: boolean; sort?: string } = {},
  onPatch = vi.fn(),
): ReturnType<typeof render> {
  const value = (key: FilterKey): string => (key === "sort" ? (over.sort ?? "nearest") : "");
  return render(
    <FilterSheet
      value={value}
      openOrStalled={over.permit ?? false}
      ooa={over.ooa ?? false}
      onPatch={onPatch}
      suggest={() => []}
      notFoundText="none"
    />,
  );
}

describe("FilterSheet optimistic controls (ERR-39)", () => {
  it("Open or stalled shows checked at once and after the pending render", async () => {
    const onPatch = vi.fn();
    sheet({}, onPatch);
    const box = screen.getByRole("radio", { name: "Open or stalled" }) as HTMLInputElement;
    fireEvent.click(box);
    expect(onPatch).toHaveBeenCalledWith({ permit: "open_stalled" });
    expect(box.checked).toBe(true);
    await act(async () => {});
    expect(box.checked).toBe(true);
  });

  it("Out-of-area owner shows checked at once and after the pending render", async () => {
    const onPatch = vi.fn();
    sheet({}, onPatch);
    const box = screen.getByRole("checkbox", { name: "Out-of-area owner" }) as HTMLInputElement;
    fireEvent.click(box);
    expect(onPatch).toHaveBeenCalledWith({ ooa: true });
    expect(box.checked).toBe(true);
    await act(async () => {});
    expect(box.checked).toBe(true);
  });

  it("Sort shows the chosen option at once and after the pending render", async () => {
    const onPatch = vi.fn();
    sheet({}, onPatch);
    const select = screen.getByRole("combobox", { name: "Sort" }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "roof_desc" } });
    expect(onPatch).toHaveBeenCalledWith({ sort: "roof_desc" });
    expect(select.value).toBe("roof_desc");
    await act(async () => {});
    expect(select.value).toBe("roof_desc");
  });

  it("follows the URL when it later commits a different value", async () => {
    const onPatch = vi.fn();
    const view = sheet({}, onPatch);
    const box = screen.getByRole("checkbox", { name: "Out-of-area owner" }) as HTMLInputElement;
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    // The URL commits something else: the same box is still unchecked there, but sort changed.
    view.rerender(
      <FilterSheet
        value={(k) => (k === "sort" ? "open_desc" : "")}
        openOrStalled={true}
        ooa={false}
        onPatch={onPatch}
        suggest={() => []}
        notFoundText="none"
      />,
    );
    await act(async () => {});
    expect(box.checked).toBe(false);
    expect(
      (screen.getByRole("radio", { name: "Open or stalled" }) as HTMLInputElement).checked,
    ).toBe(true);
    expect((screen.getByRole("combobox", { name: "Sort" }) as HTMLSelectElement).value).toBe(
      "open_desc",
    );
  });

  it("drops the optimistic value on blur when the URL never changed", async () => {
    sheet();
    const box = screen.getByRole("radio", { name: "Open or stalled" }) as HTMLInputElement;
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    fireEvent.blur(box);
    await act(async () => {});
    expect(box.checked).toBe(false);
  });
});
