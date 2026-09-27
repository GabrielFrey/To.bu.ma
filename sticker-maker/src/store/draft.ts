import { create } from 'zustand';

import { newClientJobId } from '../features/generation/generationApi';

export interface DraftPhoto {
  uri: string;
  width: number;
  height: number;
}

interface DraftState {
  photo: DraftPhoto | null;
  /** Kept so the crop screen can always start from the untouched original. */
  originalPhoto: DraftPhoto | null;
  emotionId: string | null;
  customIdea: string | null;
  stickerText: string;
  additionalInstructions: string;
  /** Stable across retries of one attempt, so a resent request cannot double charge. */
  clientJobId: string;
  setPhoto: (photo: DraftPhoto) => void;
  setCroppedPhoto: (photo: DraftPhoto) => void;
  clearPhoto: () => void;
  setEmotion: (emotionId: string | null) => void;
  setCustomIdea: (idea: string | null) => void;
  setStickerText: (text: string) => void;
  setAdditionalInstructions: (text: string) => void;
  /** Called once a generation has been accepted, so the next one gets a fresh id. */
  rotateJobId: () => void;
  reset: () => void;
}

/**
 * Deliberately not persisted: a half-finished draft pointing at a cache file that iOS has
 * since purged is worse than an empty create screen.
 */
export const useDraft = create<DraftState>((set) => ({
  photo: null,
  originalPhoto: null,
  emotionId: null,
  customIdea: null,
  stickerText: '',
  additionalInstructions: '',
  clientJobId: newClientJobId(),
  setPhoto: (photo) => set({ photo, originalPhoto: photo }),
  setCroppedPhoto: (photo) => set({ photo }),
  clearPhoto: () => set({ photo: null, originalPhoto: null }),
  setEmotion: (emotionId) => set({ emotionId, customIdea: null }),
  setCustomIdea: (customIdea) => set({ customIdea, emotionId: null }),
  setStickerText: (stickerText) => set({ stickerText }),
  setAdditionalInstructions: (additionalInstructions) => set({ additionalInstructions }),
  rotateJobId: () => set({ clientJobId: newClientJobId() }),
  reset: () =>
    set({
      photo: null,
      originalPhoto: null,
      emotionId: null,
      customIdea: null,
      stickerText: '',
      additionalInstructions: '',
      clientJobId: newClientJobId(),
    }),
}));
