import { GALLERY_BASE_ITEMS, STORAGE_KEYS } from "./data.js?v=20260920-gallery-spoilers-a1";

import { CONTENT } from "./content.js?v=20260920-gallery-spoilers-a1";

export const LOCKED_HIDDEN_CONTENT_HINT = "特定の条件を満たすと解放されます。";

const LEGACY_CAMPAIGN_HEROINE_ALIASES = [
  { codePoints: [115, 104, 105, 122, 117, 107, 97], current: "tsubaki" },
  { codePoints: [104, 105, 107, 97, 114, 105], current: "amane" },
];

function migrateCampaignId(id) {
  if (typeof id !== "string") return id;
  return LEGACY_CAMPAIGN_HEROINE_ALIASES.reduce((currentId, alias) => {
    const legacy = String.fromCharCode(...alias.codePoints);
    return currentId.replace(`campaign-${legacy}-`, `campaign-${alias.current}-`);
  }, id);
}

function loadStoredIds(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const migrated = parsed.map(migrateCampaignId);
    if (migrated.some((id, index) => id !== parsed[index])) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(migrated));
      } catch {
        // 保存不能でも、このセッションでは移行済みIDを使う。
      }
    }
    return migrated;
  } catch {
    return [];
  }
}

export function loadUnlockedGallery() {
  return loadStoredIds(STORAGE_KEYS.gallery);
}

export function loadReachedEndings() {
  return loadStoredIds(STORAGE_KEYS.endings);
}

function saveUnlockedGallery(items) {
  try {
    localStorage.setItem(STORAGE_KEYS.gallery, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

function getUnlockedGallerySet() {
  return new Set(loadUnlockedGallery());
}

function getReachedEndingsSet() {
  return new Set(loadReachedEndings());
}

function reconcileUnlockedGallery() {
  const unlocked = getUnlockedGallerySet();
  const reachedEndings = getReachedEndingsSet();
  const galleryByEnding = new Map(GALLERY_BASE_ITEMS.map(item => [item.endingId, item.id]));
  let changed = false;

  GALLERY_BASE_ITEMS.forEach((item) => {
    const relatedEndingReached = (item.unlockAfterEndingIds ?? []).some(id =>
      reachedEndings.has(id) || unlocked.has(galleryByEnding.get(id)));
    if (unlocked.has(item.id) || (!reachedEndings.has(item.endingId) && !relatedEndingReached)) {
      return;
    }
    unlocked.add(item.id);
    changed = true;
  });

  if (changed) {
    saveUnlockedGallery([...unlocked]);
  }

  return unlocked;
}

export function unlockGalleryItem(galleryId, endingId) {
  if (!galleryId || !endingId) return false;
  const gallery = getUnlockedGallerySet();
  const endings = getReachedEndingsSet();
  const newlyUnlocked = !gallery.has(galleryId) || !endings.has(endingId);
  gallery.add(galleryId);
  endings.add(endingId);
  const gallerySaved = saveUnlockedGallery([...gallery]);
  let endingsSaved = false;
  try {
    localStorage.setItem(STORAGE_KEYS.endings, JSON.stringify([...endings]));
    endingsSaved = true;
  } catch {
    // 保存不能でもゲーム進行は止めない。
  }
  // Also repair older True records when opening the gallery. Related images
  // unlock without claiming that a different ending was actually played.
  reconcileUnlockedGallery();
  return newlyUnlocked && (gallerySaved || endingsSaved);
}

// Event artwork records an image actually displayed, never an ending reached.
export function unlockEventArtwork(imagePath) {
  const items = GALLERY_BASE_ITEMS.filter(item => item.unlockOnView && item.image === imagePath);
  if (!items.length) return false;
  const unlocked = getUnlockedGallerySet();
  const fresh = items.filter(item => !unlocked.has(item.id));
  if (!fresh.length) return false;
  fresh.forEach(item => unlocked.add(item.id));
  return saveUnlockedGallery([...unlocked]);
}

export function getGalleryItems() {
  const unlocked = reconcileUnlockedGallery();
  const extrasUnlocked = getGyaruClearProgress().allCleared;
  return GALLERY_BASE_ITEMS.filter((item) => item.stageId !== "stage1" || extrasUnlocked).map((item) => {
    const isUnlocked = unlocked.has(item.id);
    const conceal = !isUnlocked && (item.hideTitleUntilUnlocked || item.stageId === "stage1");
    return {
      ...item,
      unlocked: isUnlocked,
      displayTitle: conceal ? "？？？" : item.title,
      displayDescription: isUnlocked ? item.description
        : conceal ? LOCKED_HIDDEN_CONTENT_HINT : "この記録はまだ空白です。",
    };
  });
}

// True records already mean a win/KO over the gyaru champion. Reuse both
// existing stores: either write can survive when localStorage is partially full.
// The same gate controls the extras entrance and the hidden-mode photo album.
export function getGyaruClearProgress() {
  const heroineIds = CONTENT.campaign?.playableHeroineIds ?? [];
  const endings = new Set(loadReachedEndings());
  const gallery = new Set(loadUnlockedGallery());
  const clearedHeroineIds = heroineIds.filter((id) => {
    const ending = CONTENT.campaign?.endingVariants?.[id]?.true;
    return Boolean(ending?.id && (endings.has(ending.id)
      || (ending.galleryId && gallery.has(ending.galleryId))));
  });
  return {
    clearedHeroineIds,
    remainingHeroineIds: heroineIds.filter((id) => !clearedHeroineIds.includes(id)),
    allCleared: heroineIds.length > 0 && clearedHeroineIds.length === heroineIds.length,
  };
}
