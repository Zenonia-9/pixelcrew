import looks from "../resources/character-looks.json";
export const characterLooks = looks;
export const characterKinds = [
  { id: "atlas", name: "Owl mage" },
  { id: "pip", name: "Fox explorer" },
  { id: "bolt", name: "Workshop robot" },
  { id: "mira", name: "Cat artist" },
  { id: "nova", name: "Star robot" },
] as const;
export type CharacterKind = (typeof characterKinds)[number]["id"];
export type CharacterAppearance = { sprite: CharacterKind; look?: string };
export function spriteAsset(agent: CharacterAppearance, life = false) {
  const look =
    characterLooks.find((look) => look.id === agent.look)?.id || "classic";
  const stem = look === "classic" ? agent.sprite : `${agent.sprite}-${look}`;
  return `/sprites/${stem}${life ? "-life" : ""}.png`;
}

export function walkSpriteAsset(agent: CharacterAppearance) {
  return spriteAsset(agent).replace(/\.png$/, "-walk.png");
}
