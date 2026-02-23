import { fabric } from 'fabric';
import {
  STICKY_NOTE_COLORS,
  SHAPE_COLORS,
  OBJECT_DEFAULTS,
} from 'shared';
import type { BoardObject } from 'shared';
import { DEFAULT_SYSTEM_FONT, getStickyChildren } from './fabricStyleHelpers';
import { createStickyNote, createRectangle, createCircle, createTriangle, createArrow, createStar, createDiamond, createTextElement, createFlagMarker } from './fabricShapeFactory';
import { createFrame } from './fabricFrameHelpers';
import { createConnector, createLine } from './fabricConnectorHelpers';

// ============================================================
// Conversion: Fabric Object -> BoardObject (for store tracking)
// ============================================================

/**
 * Converts a Fabric.js object into a BoardObject suitable for
 * storing in the Zustand boardStore.
 *
 * Accepts an optional userId parameter for the authenticated user.
 * Falls back to 'local-user' if not provided (Phase 3 local-only mode).
 */
export function fabricToBoardObject(fabricObj: fabric.Object, userId?: string): BoardObject {
  const data = fabricObj.data!;
  const now = new Date();
  const user = userId ?? 'local-user';

  // Fabric.js uses scaleX/scaleY for resize, NOT width/height.
  // Multiply intrinsic dimensions by scale to get actual rendered size.
  const scaleX = fabricObj.scaleX ?? 1;
  const scaleY = fabricObj.scaleY ?? 1;

  const base = {
    id: data.id,
    x: fabricObj.left ?? 0,
    y: fabricObj.top ?? 0,
    frameId: (data.frameId as string | null) ?? null,
    createdBy: user,
    createdAt: now,
    updatedAt: now,
    lastEditedBy: user,
  };

  if (data.type === 'sticky') {
    // Sticky is now a Group — get color from child base polygon
    let color: string = STICKY_NOTE_COLORS[0];
    if (fabricObj instanceof fabric.Group) {
      const { base: basePoly } = getStickyChildren(fabricObj);
      color = basePoly.fill as string;
    }
    return {
      ...base,
      type: 'sticky' as const,
      text: data.text ?? '',
      color,
      width: (fabricObj.width ?? OBJECT_DEFAULTS.STICKY_WIDTH) * scaleX,
      height: (fabricObj.height ?? OBJECT_DEFAULTS.STICKY_HEIGHT) * scaleY,
    };
  }

  if (data.type === 'shape' && data.shapeType === 'circle') {
    const circle = fabricObj as fabric.Circle;
    const diameter = (circle.radius ?? 75) * 2 * scaleX;
    return {
      ...base,
      type: 'shape' as const,
      shapeType: 'circle' as const,
      width: diameter,
      height: diameter,
      color: circle.fill as string,
      rotation: fabricObj.angle ?? 0,
    };
  }

  if (data.type === 'text') {
    const itext = fabricObj as fabric.IText;
    const fontFamily = itext.fontFamily;
    return {
      ...base,
      type: 'text' as const,
      text: itext.text ?? '',
      fontSize: itext.fontSize ?? 24,
      color: (itext.fill as string) ?? '#000000',
      fontFamily: fontFamily && fontFamily !== DEFAULT_SYSTEM_FONT ? fontFamily : undefined,
      rotation: fabricObj.angle ?? 0,
      scaleX: scaleX !== 1 ? scaleX : undefined,
      scaleY: scaleY !== 1 ? scaleY : undefined,
    };
  }

  if (data.type === 'frame') {
    // Frame color is stored as the child rect's stroke color
    let frameColor = '#555555';
    if (fabricObj instanceof fabric.Group) {
      const borderRect = fabricObj.getObjects()[0];
      frameColor = (borderRect.stroke as string) ?? '#555555';
    }
    return {
      ...base,
      type: 'frame' as const,
      title: data.title ?? 'Frame',
      width: (fabricObj.width ?? 400) * scaleX,
      height: (fabricObj.height ?? 300) * scaleY,
      color: frameColor,
      locked: data.locked ?? false,
    };
  }

  if (data.type === 'line') {
    const lineObj = fabricObj as fabric.Line;
    return {
      ...base,
      x: lineObj.x1 ?? 0,
      y: lineObj.y1 ?? 0,
      type: 'line' as const,
      color: (lineObj.stroke as string) ?? '#FFFFFF',
      x2: lineObj.x2 ?? 0,
      y2: lineObj.y2 ?? 0,
      endpointStyle: data.endpointStyle ?? 'none',
      strokePattern: data.strokePattern ?? 'solid',
      strokeWeight: data.strokeWeight ?? 'normal',
    };
  }

  if (data.type === 'connector') {
    const line = fabricObj as fabric.Line;
    // Connector x/y must be the FIRST endpoint (x1/y1), NOT left/top.
    // left/top = min(x1,x2)/min(y1,y2) which loses orientation info.
    // createConnector treats options.x/y as x1/y1, so we must serialize
    // the actual first endpoint to preserve the line's direction.
    return {
      ...base,
      x: line.x1 ?? 0,
      y: line.y1 ?? 0,
      type: 'connector' as const,
      fromObjectId: data.fromObjectId ?? '',
      toObjectId: data.toObjectId ?? '',
      fromAnchor: data.fromAnchor ?? null,
      toAnchor: data.toAnchor ?? null,
      style: data.style ?? 'line',
      color: (line.stroke as string) ?? '#FFFFFF',
      x2: line.x2 ?? 0,
      y2: line.y2 ?? 0,
    };
  }

  // Default: rectangle or polygon shape (arrow, star, triangle, diamond)
  if (data.type === 'shape' && (data.shapeType === 'arrow' || data.shapeType === 'star' || data.shapeType === 'triangle' || data.shapeType === 'diamond')) {
    return {
      ...base,
      type: 'shape' as const,
      shapeType: data.shapeType as 'arrow' | 'star' | 'triangle' | 'diamond',
      width: (fabricObj.width ?? 150) * scaleX,
      height: (fabricObj.height ?? 150) * scaleY,
      color: (fabricObj.fill as string) ?? SHAPE_COLORS[0],
      rotation: fabricObj.angle ?? 0,
    };
  }

  return {
    ...base,
    type: 'shape' as const,
    shapeType: 'rectangle' as const,
    width: (fabricObj.width ?? OBJECT_DEFAULTS.SHAPE_WIDTH) * scaleX,
    height: (fabricObj.height ?? OBJECT_DEFAULTS.SHAPE_HEIGHT) * scaleY,
    color: (fabricObj as fabric.Rect).fill as string,
    rotation: fabricObj.angle ?? 0,
  };
}

// ============================================================
// Conversion: BoardObject -> Fabric Object (for rendering server state)
// ============================================================

/**
 * Converts a BoardObject (from server) into a Fabric.js object for rendering.
 * This is the reverse of fabricToBoardObject — used when loading board:state
 * or applying object:created events from other users.
 */
export function boardObjectToFabric(obj: BoardObject): fabric.Object | null {
  let fabricObj: fabric.Object | null = null;

  switch (obj.type) {
    case 'sticky':
      fabricObj = createStickyNote({
        x: obj.x,
        y: obj.y,
        color: obj.color,
        text: obj.text,
        id: obj.id,
        width: obj.width,
        height: obj.height,
      });
      break;

    case 'shape':
      if (obj.shapeType === 'circle') {
        const circle = createCircle({
          x: obj.x,
          y: obj.y,
          color: obj.color,
          radius: obj.width / 2,
          id: obj.id,
        });
        if (obj.rotation) circle.set('angle', obj.rotation);
        fabricObj = circle;
      } else if (obj.shapeType === 'arrow') {
        const arrowShape = createArrow({
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
          color: obj.color,
          id: obj.id,
        });
        if (obj.rotation) arrowShape.set('angle', obj.rotation);
        fabricObj = arrowShape;
      } else if (obj.shapeType === 'star') {
        const starShape = createStar({
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
          color: obj.color,
          id: obj.id,
        });
        if (obj.rotation) starShape.set('angle', obj.rotation);
        fabricObj = starShape;
      } else if (obj.shapeType === 'triangle') {
        const triShape = createTriangle({
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
          color: obj.color,
          id: obj.id,
        });
        if (obj.rotation) triShape.set('angle', obj.rotation);
        fabricObj = triShape;
      } else if (obj.shapeType === 'diamond') {
        const diamondShape = createDiamond({
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
          color: obj.color,
          id: obj.id,
        });
        if (obj.rotation) diamondShape.set('angle', obj.rotation);
        fabricObj = diamondShape;
      } else if (obj.shapeType === 'rectangle') {
        const rect = createRectangle({
          x: obj.x,
          y: obj.y,
          color: obj.color,
          width: obj.width,
          height: obj.height,
          id: obj.id,
        });
        if (obj.rotation) rect.set('angle', obj.rotation);
        fabricObj = rect;
      }
      break;

    case 'text': {
      const textEl = createTextElement({
        x: obj.x,
        y: obj.y,
        text: obj.text,
        fontSize: obj.fontSize,
        color: obj.color,
        fontFamily: obj.fontFamily,
        id: obj.id,
      });
      if (obj.rotation) textEl.set('angle', obj.rotation);
      // Restore resize scale (IText uses scaleX/Y, not width/height)
      if (obj.scaleX) textEl.set('scaleX', obj.scaleX);
      if (obj.scaleY) textEl.set('scaleY', obj.scaleY);
      fabricObj = textEl;
      break;
    }

    case 'frame':
      fabricObj = createFrame({
        x: obj.x,
        y: obj.y,
        title: obj.title,
        width: obj.width,
        height: obj.height,
        color: obj.color,
        locked: obj.locked,
        id: obj.id,
      });
      break;

    case 'line':
      fabricObj = createLine({
        x: obj.x,
        y: obj.y,
        x2: obj.x2,
        y2: obj.y2,
        color: obj.color,
        endpointStyle: obj.endpointStyle,
        strokePattern: obj.strokePattern,
        strokeWeight: obj.strokeWeight,
        id: obj.id,
      });
      break;

    case 'connector':
      fabricObj = createConnector({
        x: obj.x,
        y: obj.y,
        x2: obj.x2,
        y2: obj.y2,
        color: obj.color,
        style: obj.style,
        fromObjectId: obj.fromObjectId,
        toObjectId: obj.toObjectId,
        fromAnchor: obj.fromAnchor ?? null,
        toAnchor: obj.toAnchor ?? null,
        id: obj.id,
      });
      break;
  }

  // Attach frameId to fabric data for all object types
  if (fabricObj && obj.frameId) {
    fabricObj.data = { ...fabricObj.data, frameId: obj.frameId };
  }

  return fabricObj;
}
