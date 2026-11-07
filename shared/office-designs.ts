export const officeDesigns = [
  {
    id: "paper",
    name: "Paper & oak",
    description: "Warm ivory plaster, honey oak and muted sage workrooms.",
    wall: "#c6bca3",
    trim: "#575c4a",
    floor: "#8c7657",
    tile: "#968263",
    grout: "#75664e",
    pattern: "plank",
  },
  {
    id: "slate",
    name: "Slate & copper",
    description:
      "Ink-blue plaster, quiet slate floors and warm copper details.",
    wall: "#3e5360",
    trim: "#263944",
    floor: "#536166",
    tile: "#5a686d",
    grout: "#455359",
    pattern: "slate",
  },
  {
    id: "timber",
    name: "Timber workshop",
    description: "Warm wood floors and moss-green walls.",
    wall: "#3c4b3a",
    trim: "#253c34",
    floor: "#735536",
    tile: "#886641",
    grout: "#493f31",
    pattern: "wood",
  },
  {
    id: "garden",
    name: "Garden studio",
    description: "Sage walls, pale stone tiles and a sunlit glass canopy.",
    wall: "#78937d",
    trim: "#304f46",
    floor: "#b8bea5",
    tile: "#cbd0b7",
    grout: "#89977e",
    pattern: "stone",
  },
  {
    id: "midnight",
    name: "Midnight lab",
    description: "Deep blue walls, a star window and a dark geometric floor.",
    wall: "#25374f",
    trim: "#172638",
    floor: "#344454",
    tile: "#405567",
    grout: "#243340",
    pattern: "grid",
  },
  {
    id: "clay",
    name: "Clay atelier",
    description: "Terracotta walls and a cream checkerboard floor.",
    wall: "#a66e59",
    trim: "#624c48",
    floor: "#cbb89b",
    tile: "#e0d2b7",
    grout: "#a38f78",
    pattern: "check",
  },
] as const;
export type OfficeDesignId = (typeof officeDesigns)[number]["id"];
export function officeDesign(id?: string) {
  return (
    officeDesigns.find((design) => design.id === id) ||
    officeDesigns.find((design) => design.id === "timber")!
  );
}
