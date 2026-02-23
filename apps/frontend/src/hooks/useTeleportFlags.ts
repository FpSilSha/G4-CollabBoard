import { useEffect } from 'react';
import { fabric } from 'fabric';
import { useAuth0 } from '@auth0/auth0-react';
import { useFlagStore } from '../stores/flagStore';
import { useBoardStore } from '../stores/boardStore';
import { useUIStore } from '../stores/uiStore';
import { useDemoStore } from '../stores/demoStore';
import { createFlagMarker, FLAG_COLORS } from '../utils/fabricHelpers';

const AUTH_PARAMS = {
  authorizationParams: {
    audience: import.meta.env.VITE_AUTH0_AUDIENCE || 'https://collabboard-api',
  },
};

/**
 * Hook that manages teleport flag canvas interactions:
 * - Handles "Place Flag" tool click → label prompt → API create → canvas marker
 * - Handles flag marker drag → PATCH API to persist new position
 *
 * NOTE: Flag loading is handled by board:state in useCanvasSync.ts — not here.
 */
export function useTeleportFlags() {
  const { getAccessTokenSilently } = useAuth0();
  const canvas = useBoardStore((s) => s.canvas);

  // ========================================
  // "Place Flag" tool — click on canvas to place
  // ========================================
  useEffect(() => {
    if (!canvas) return;

    const handlePlaceFlagClick = async (opt: fabric.IEvent) => {
      const tool = useUIStore.getState().activeTool;
      if (tool !== 'placeFlag') return;
      // Only place on empty canvas area
      if (opt.target) return;

      const pointer = canvas.getPointer(opt.e);
      const x = pointer.x;
      const y = pointer.y;

      // Reset tool immediately so further clicks don't double-place
      useUIStore.getState().setActiveTool('select');

      // Prompt for label via modal
      const label = await useUIStore.getState().openTextInputModal({
        title: 'Flag Label',
        placeholder: 'Enter a name for this flag',
      });
      if (!label) return;

      const currentBoardId = useBoardStore.getState().boardId;
      if (!currentBoardId) return;

      const color = FLAG_COLORS[useFlagStore.getState().flags.length % FLAG_COLORS.length];

      try {
        // Demo mode: create locally, no API
        const currentIsDemoMode = useDemoStore.getState().isDemoMode;
        let flag;
        if (currentIsDemoMode) {
          flag = useFlagStore.getState().createFlagLocal(
            currentBoardId,
            { label, x, y, color },
          );
        } else {
          const token = await getAccessTokenSilently(AUTH_PARAMS);
          flag = await useFlagStore.getState().createFlag(
            currentBoardId,
            { label, x, y, color },
            token,
          );
        }

        // Add marker to canvas
        const marker = createFlagMarker({
          x: flag.x,
          y: flag.y,
          color: flag.color,
          flagId: flag.id,
          label: flag.label,
        });
        canvas.add(marker);
        canvas.requestRenderAll();
      } catch (err) {
        console.error('[useTeleportFlags] createFlag error:', err);
      }
    };

    canvas.on('mouse:down', handlePlaceFlagClick);
    return () => {
      canvas.off('mouse:down', handlePlaceFlagClick);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas]);

  // ========================================
  // Flag marker drag → PATCH API to persist new position
  // ========================================
  useEffect(() => {
    if (!canvas) return;

    const handleFlagModified = async (opt: fabric.IEvent) => {
      const target = opt.target;
      if (!target || target.data?.type !== 'teleportFlag') return;

      const flagId = target.data.flagId as string;
      if (!flagId) return;

      const newX = target.left ?? 0;
      const newY = target.top ?? 0;

      // Update local store optimistically
      useFlagStore.getState().updateFlagLocal(flagId, { x: newX, y: newY });

      // Demo mode: local-only, no API persist needed
      const currentIsDemoMode = useDemoStore.getState().isDemoMode;
      if (currentIsDemoMode) return;

      // Remember original position for rollback on auth failure
      const flag = useFlagStore.getState().flags.find((f) => f.id === flagId);
      const origX = flag?.x ?? newX;
      const origY = flag?.y ?? newY;

      // Persist to API
      const currentBoardId = useBoardStore.getState().boardId;
      if (!currentBoardId) return;

      try {
        const token = await getAccessTokenSilently(AUTH_PARAMS);
        await useFlagStore.getState().updateFlag(
          currentBoardId,
          flagId,
          { x: newX, y: newY },
          token,
        );
      } catch (err) {
        console.error('[useTeleportFlags] updateFlag position error:', err);
        // Rollback: restore original position on canvas and in store
        useFlagStore.getState().updateFlagLocal(flagId, { x: origX, y: origY });
        target.set({ left: origX, top: origY });
        target.setCoords();
        canvas.requestRenderAll();
        useUIStore.getState().showToast('Cannot move this flag — you are not the creator or board owner');
      }
    };

    canvas.on('object:modified', handleFlagModified);
    return () => {
      canvas.off('object:modified', handleFlagModified);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas]);
}
