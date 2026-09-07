export interface CoalescingSaveQueueOptions {
  getSave: () => () => Promise<void>;
}

export interface CoalescingSaveQueue {
  request: () => Promise<void>;
}

/**
 * Serializes every save source (auto-save, toolbar and navigation guards).
 * Calls made while a save is in flight coalesce into one follow-up save that
 * reads the latest React snapshot through getSave().
 */
export const createCoalescingSaveQueue = ({
  getSave
}: CoalescingSaveQueueOptions): CoalescingSaveQueue => {
  let saveRequested = false;
  let activeSave: Promise<void> | null = null;

  const request = () => {
    saveRequested = true;
    if (activeSave) return activeSave;

    activeSave = (async () => {
      let latestError: unknown = null;
      while (saveRequested) {
        saveRequested = false;
        try {
          await getSave()();
          latestError = null;
        } catch (error) {
          latestError = error;
        }
      }
      if (latestError) throw latestError;
    })().finally(() => {
      activeSave = null;
    });

    return activeSave;
  };

  return { request };
};
