// Optional presentation metadata. Missing fields preserve the existing game screen.
export function localMediaPath(value) {
  return typeof value === "string" && value.startsWith("assets/")
    && !/[<>"'`\\?#:\u0000-\u001f]/.test(value)
    && !value.split("/").some((part) => part === ".." || part === "." || !part)
    ? value : "";
}

export function resolveDialoguePresentation(content, line = {}, fallbackId = "ren", lines = []) {
  const characterId = content.heroines?.[line.characterId] ? line.characterId : fallbackId;
  const registry = content.standingSprites ?? content.standing_sprites;
  const character = registry?.characters?.[characterId];
  const outfit = character?.outfits?.[character.defaultOutfit];
  const key = `${line.expression || outfit?.defaultExpression}.${line.pose || outfit?.defaultPose}`;
  const defaultKey = `${outfit?.defaultExpression}.${outfit?.defaultPose}`;
  const sprite = outfit?.sprites?.[key] ?? outfit?.sprites?.[defaultKey];
  const presentation = {
    characterId,
    hideSprite: line.sprite === "none",
    layout: line.layout === "pov" ? "pov" : "",
    foreground: localMediaPath(line.foreground),
    sprite: line.sprite === "none" ? "" : localMediaPath(line.sprite) || localMediaPath(sprite?.src),
    position: ["left", "center", "right"].includes(line.position) ? line.position : "center",
    background: localMediaPath(line.background),
    backgroundFallback: localMediaPath(line.backgroundFallback),
  };
  const names = Object.entries(content.heroines ?? {});
  const speakers = [...new Set(lines.map((row) => names.find(([, hero]) => hero.name === row.speaker)?.[0]).filter(Boolean))];
  const secondaryId = line.secondaryCharacterId === "none" ? null
    : content.heroines?.[line.secondaryCharacterId] ? line.secondaryCharacterId
    : speakers.length === 2 && speakers.includes(characterId) ? speakers.find((id) => id !== characterId) : null;
  presentation.actors = [];
  if (!presentation.hideSprite) {
    const paired = secondaryId && secondaryId !== characterId && !presentation.layout;
    // Anchor slots for the whole conversation, not whichever character owns this line.
    // The first explicit left/right placement remains the scene's layout anchor.
    const pairIds = paired ? [characterId, secondaryId] : [];
    const anchorLine = [...lines, line].find((row) => ["left", "right"].includes(row.position)
      && pairIds.includes(content.heroines?.[row.characterId] ? row.characterId : fallbackId));
    const anchorId = anchorLine
      ? (content.heroines?.[anchorLine.characterId] ? anchorLine.characterId : fallbackId)
      : pairIds.includes(fallbackId) ? fallbackId : speakers[0] ?? characterId;
    const anchorPosition = anchorLine?.position ?? "right";
    const primaryPosition = characterId === anchorId ? anchorPosition : anchorPosition === "left" ? "right" : "left";
    const highlighted = (id) => line.highlightSpeaker !== false && line.speaker === content.heroines?.[id]?.name;
    presentation.actors.push({ characterId, sprite: presentation.sprite,
      position: paired ? primaryPosition : presentation.position,
      speaking: highlighted(characterId), dimmed: line.highlightSpeaker !== false && !highlighted(characterId) });
    if (paired) {
      const secondary = resolveDialoguePresentation(content, { characterId: secondaryId,
        sprite: line.secondarySprite, expression: line.secondaryExpression, pose: line.secondaryPose }, secondaryId);
      presentation.actors.push({ characterId: secondaryId, sprite: secondary.sprite,
        position: presentation.actors[0].position === "left" ? "right" : "left",
        speaking: highlighted(secondaryId), dimmed: line.highlightSpeaker !== false && !highlighted(secondaryId) });
    }
  }
  return presentation;
}
