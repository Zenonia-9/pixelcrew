import {
  characterKinds,
  characterLooks,
  spriteAsset,
  type CharacterAppearance,
} from "../shared/character-assets";
export function CharacterPreview({
  appearance,
  size = 64,
}: {
  appearance: CharacterAppearance;
  size?: number;
}) {
  return (
    <span
      className="portrait"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${spriteAsset(appearance)})`,
        backgroundSize: `${size * 8}px ${size}px`,
      }}
    />
  );
}
export function AppearancePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: CharacterAppearance;
  onChange: (value: CharacterAppearance) => void;
  disabled?: boolean;
}) {
  return (
    <div className="appearance-picker">
      <fieldset disabled={disabled}>
        <legend>Character</legend>
        <div className="character-options">
          {characterKinds.map((kind) => (
            <button
              type="button"
              key={kind.id}
              aria-pressed={value.sprite === kind.id}
              onClick={() => onChange({ ...value, sprite: kind.id })}
            >
              <CharacterPreview
                appearance={{ ...value, sprite: kind.id }}
                size={56}
              />
              <span>{kind.name}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>Premade outfit</legend>
        <div className="character-options look-options">
          {characterLooks.map((look) => (
            <button
              type="button"
              key={look.id}
              aria-pressed={(value.look || "classic") === look.id}
              onClick={() => onChange({ ...value, look: look.id })}
            >
              <CharacterPreview
                appearance={{ ...value, look: look.id }}
                size={56}
              />
              <span>{look.name}</span>
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
