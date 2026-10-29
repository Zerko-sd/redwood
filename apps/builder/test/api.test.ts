import { describe, expect, it } from "vitest";
import { freshId, slug } from "../src/api";

describe("ids the Builder makes", () => {
  it("slugs a name into the form the spec accepts", () => {
    expect(slug("Plate Number!")).toBe("plate-number");
    expect(slug("  Équipe  du soir ")).toBe("equipe-du-soir");
    expect(slug("日本語")).toBe("");
  });

  it("never reuses an id, and always matches the spec's id pattern", () => {
    const taken = ["story:book-a-class", "story:book-a-class-2"];
    expect(freshId("story", "Book a class", taken)).toBe("story:book-a-class-3");
    expect(freshId("role", "Driver", [])).toBe("role:driver");
    // a name with no usable characters still gets a valid id
    expect(freshId("entity", "日本語", [])).toMatch(/^entity:[a-z0-9][a-z0-9-]*$/);
  });
});
