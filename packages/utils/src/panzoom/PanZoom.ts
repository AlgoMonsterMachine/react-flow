import { D3ZoomEvent, ZoomTransform, zoom, zoomIdentity } from 'd3-zoom';
import { select, pointer } from 'd3-selection';
import {
  PanOnScrollMode,
  type CoordinateExtent,
  type Transform,
  type Viewport,
  D3ZoomInstance,
  D3SelectionInstance,
  D3ZoomHandler,
  PanZoomTransformOptions,
  PanZoomUpdateOptions,
  InitPanZoomParams,
  OnDraggingChange,
  OnTransformChange,
  PanZoomInstance,
} from '@reactflow/system';

import {
  FilterParams,
  PanOnScrollParams,
  PanZoomEndParams,
  PanZoomParams,
  PanZoomStartParams,
  ZoomOnScrollParams,
  ZoomPanValues,
} from './types';
import { clamp } from '../utils';
import { Updater } from './utils';

const viewChanged = (prevViewport: Viewport, eventViewport: any): boolean =>
  prevViewport.x !== eventViewport.x || prevViewport.y !== eventViewport.y || prevViewport.zoom !== eventViewport.k;

const eventToFlowTransform = (eventViewport: any): Viewport => ({
  x: eventViewport.x,
  y: eventViewport.y,
  zoom: eventViewport.k,
});

const isWrappedWithClass = (event: any, className: string | undefined) => event.target.closest(`.${className}`);

const isRightClickPan = (panOnDrag: boolean | number[], usedButton: number) =>
  usedButton === 2 && Array.isArray(panOnDrag) && panOnDrag.includes(2);

const getD3Transition = (selection: D3SelectionInstance, duration = 0) => {
  return selection.transition().duration(duration);
};

export function PanZoom(): PanZoomInstance {
  const zoomPanValues: ZoomPanValues = {
    isZoomingOrPanning: false,
    zoomedWithRightMouseButton: false,
    prevTransform: { x: 0, y: 0, zoom: 0 },
    mouseButton: 0,
    timerId: undefined,
  };

  let d3Selection: D3SelectionInstance | null = null;
  let d3ZoomHandler: D3ZoomHandler | null = null;
  let d3ZoomInstance: D3ZoomInstance | null = null;
  let onDraggingChange: OnDraggingChange;
  let onTransformChange: OnTransformChange;

  const updater = Updater();

  function init({
    domNode,
    minZoom,
    maxZoom,
    translateExtent,
    viewport,
    onTransformChange: _onTransformChange,
    onDraggingChange: _onDraggingChange,
  }: InitPanZoomParams) {
    const bbox = domNode.getBoundingClientRect();
    d3ZoomInstance = zoom().scaleExtent([minZoom, maxZoom]).translateExtent(translateExtent);
    d3Selection = select(domNode).call(d3ZoomInstance);

    const extent: CoordinateExtent = [
      [0, 0],
      [bbox.width, bbox.height],
    ];

    const constrainedTransform = setTransformXYZConstrained(
      {
        x: viewport.x,
        y: viewport.y,
        zoom: clamp(viewport.zoom, minZoom, maxZoom),
      },
      extent,
      translateExtent
    );

    d3ZoomHandler = d3Selection.on('wheel.zoom') || null;

    onTransformChange = _onTransformChange;
    onDraggingChange = _onDraggingChange;

    return {
      transform: [
        constrainedTransform?.x ?? 0,
        constrainedTransform?.y ?? 0,
        constrainedTransform?.k ?? 1,
      ] as Transform,
    };
  }

  function update({
    elementsSelectable,
    noWheelClassName,
    noPanClassName,
    onMove,
    onMoveStart,
    onMoveEnd,
    onViewportChangeStart,
    onViewportChange,
    onViewportChangeEnd,
    userSelectionActive,
    onPaneContextMenu,
    panOnScroll,
    panOnDrag,
    panOnScrollMode,
    panOnScrollSpeed,
    preventScrolling,
    zoomOnPinch,
    zoomOnScroll,
    zoomOnDoubleClick,
    zoomActivationKeyPressed,
  }: PanZoomUpdateOptions) {
    // wheel scroll / pan handling
    updater.onChange(() => {
      if (!d3ZoomInstance || !d3Selection) {
        return;
      }

      if (panOnScroll && !zoomActivationKeyPressed && !userSelectionActive) {
        const panOnScrollHandler = createPanOnScrollHandler({
          noWheelClassName,
          d3Selection,
          d3Zoom: d3ZoomInstance,
          panOnScrollMode,
          panOnScrollSpeed,
          zoomOnPinch,
        });
        d3Selection.on('wheel.zoom', panOnScrollHandler, { passive: false });
      } else if (d3ZoomHandler !== null) {
        const zoomOnScrollHandler = createZoomOnScrollHandler({
          noWheelClassName,
          preventScrolling,
          d3ZoomHandler,
        });
        d3Selection.on('wheel.zoom', zoomOnScrollHandler, { passive: false });
      }
    }, [
      userSelectionActive,
      panOnScroll,
      panOnScrollMode,
      d3Selection,
      d3ZoomInstance,
      d3ZoomHandler,
      zoomActivationKeyPressed,
      zoomOnPinch,
      preventScrolling,
      noWheelClassName,
    ]);

    // pan zoom start
    updater.onChange(() => {
      const startHandler = createPanZoomStartHandler({
        zoomPanValues,
        onDraggingChange,
        onMoveStart,
        onViewportChangeStart,
      });
      d3ZoomInstance?.on('start', startHandler);
    }, [d3ZoomInstance, onMoveStart]);

    // pan zoom
    updater.onChange(() => {
      if (!d3ZoomInstance) {
        return;
      }
      if (userSelectionActive && !zoomPanValues.isZoomingOrPanning) {
        d3ZoomInstance.on('zoom', null);
      } else if (!userSelectionActive) {
        const panZoomHandler = createPanZoomHandler({
          zoomPanValues: zoomPanValues,
          panOnDrag,
          onPaneContextMenu: !!onPaneContextMenu,
          onMove,
          onViewportChange,
          onTransformChange,
        });
        d3ZoomInstance.on('zoom', panZoomHandler);
      }
    }, [userSelectionActive, d3ZoomInstance, onMove, panOnDrag, onPaneContextMenu]);

    // pan zoom
    updater.onChange(() => {
      const panZoomEndHandler = createPanZoomEndHandler({
        zoomPanValues: zoomPanValues,
        panOnDrag,
        panOnScroll,
        onPaneContextMenu,
        onMoveEnd,
        onViewportChangeEnd,
        onDraggingChange,
      });
      d3ZoomInstance?.on('end', panZoomEndHandler);
    }, [d3ZoomInstance, panOnScroll, panOnDrag, onMoveEnd, onPaneContextMenu]);

    // apply filter
    updater.onChange(() => {
      const filter = createFilter({
        zoomActivationKeyPressed,
        panOnDrag,
        zoomOnScroll,
        panOnScroll,
        zoomOnDoubleClick,
        zoomOnPinch,
        userSelectionActive,
        noPanClassName,
        noWheelClassName,
      });
      d3ZoomInstance?.filter(filter);
    }, [
      userSelectionActive,
      d3ZoomInstance,
      zoomOnScroll,
      zoomOnPinch,
      panOnScroll,
      zoomOnDoubleClick,
      panOnDrag,
      elementsSelectable,
      zoomActivationKeyPressed,
    ]);
  }

  function setTransformXYZConstrained(
    { x, y, zoom }: Viewport,
    extent: CoordinateExtent,
    translateExtent: CoordinateExtent
  ): ZoomTransform | undefined {
    const nextTransform = zoomIdentity.translate(x, y).scale(zoom);

    const contrainedTransform = d3ZoomInstance?.constrain()(nextTransform, extent, translateExtent);

    if (contrainedTransform) {
      setTransform(contrainedTransform);
    }

    return contrainedTransform;
  }

  function setTransformXYZ({ x, y, zoom }: Viewport, options?: PanZoomTransformOptions) {
    const nextTransform = zoomIdentity.translate(x, y).scale(zoom);

    setTransform(nextTransform, options);

    return nextTransform;
  }

  function setTransform(_transform: ZoomTransform, options?: PanZoomTransformOptions) {
    if (!d3ZoomInstance || !d3Selection) {
      return;
    }

    const zoomSelection =
      typeof options?.duration === 'number' && options.duration > 0
        ? getD3Transition(d3Selection, options.duration)
        : d3Selection;

    d3ZoomInstance.transform(zoomSelection, _transform);
  }

  function setScaleExtent(scaleExtent: [number, number]) {
    if (!d3ZoomInstance) {
      return null;
    }
    d3ZoomInstance.scaleExtent(scaleExtent);
  }

  function setTranslateExtent(translateExtent: CoordinateExtent) {
    if (!d3ZoomInstance) {
      return null;
    }
    d3ZoomInstance.translateExtent(translateExtent);
  }

  function scaleTo(zoom: number, options?: PanZoomTransformOptions) {
    if (!d3ZoomInstance || !d3Selection) {
      return;
    }

    d3ZoomInstance.scaleTo(getD3Transition(d3Selection, options?.duration), zoom);
  }

  function scaleBy(factor: number, options?: PanZoomTransformOptions) {
    if (!d3ZoomInstance || !d3Selection) {
      return;
    }

    d3ZoomInstance.scaleBy(getD3Transition(d3Selection, options?.duration), factor);
  }

  return {
    init,
    update,
    setTransform,
    setTransformXYZ,
    setTransformXYZConstrained,
    setScaleExtent,
    setTranslateExtent,
    scaleTo,
    scaleBy,
  };
}

export function createPanOnScrollHandler({
  noWheelClassName,
  d3Selection,
  d3Zoom,
  panOnScrollMode,
  panOnScrollSpeed,
  zoomOnPinch,
}: PanOnScrollParams) {
  return (event: any) => {
    if (isWrappedWithClass(event, noWheelClassName)) {
      return false;
    }
    event.preventDefault();
    event.stopImmediatePropagation();

    const currentZoom = d3Selection.property('__zoom').k || 1;

    if (event.ctrlKey && zoomOnPinch) {
      const point = pointer(event);
      // taken from https://github.com/d3/d3-zoom/blob/master/src/zoom.js
      const pinchDelta = -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002) * 10;
      const zoom = currentZoom * Math.pow(2, pinchDelta);
      d3Zoom.scaleTo(d3Selection, zoom, point);

      return;
    }

    // increase scroll speed in firefox
    // firefox: deltaMode === 1; chrome: deltaMode === 0
    const deltaNormalize = event.deltaMode === 1 ? 20 : 1;
    const deltaX = panOnScrollMode === PanOnScrollMode.Vertical ? 0 : event.deltaX * deltaNormalize;
    const deltaY = panOnScrollMode === PanOnScrollMode.Horizontal ? 0 : event.deltaY * deltaNormalize;

    d3Zoom.translateBy(
      d3Selection,
      -(deltaX / currentZoom) * panOnScrollSpeed,
      -(deltaY / currentZoom) * panOnScrollSpeed
    );
  };
}

export function createZoomOnScrollHandler({ noWheelClassName, preventScrolling, d3ZoomHandler }: ZoomOnScrollParams) {
  return function (this: Element, event: any, d: unknown) {
    if (!preventScrolling || isWrappedWithClass(event, noWheelClassName)) {
      return null;
    }

    event.preventDefault();

    d3ZoomHandler.call(this, event, d);
  };
}

export function createPanZoomStartHandler({
  zoomPanValues,
  onDraggingChange,
  onMoveStart,
  onViewportChangeStart,
}: PanZoomStartParams) {
  return (event: D3ZoomEvent<HTMLDivElement, any>) => {
    // we need to remember it here, because it's always 0 in the "zoom" event
    zoomPanValues.mouseButton = event.sourceEvent?.button || 0;

    zoomPanValues.isZoomingOrPanning = true;

    if (event.sourceEvent?.type === 'mousedown') {
      onDraggingChange(true);
    }

    if (onMoveStart || onViewportChangeStart) {
      const flowTransform = eventToFlowTransform(event.transform);
      zoomPanValues.prevTransform = flowTransform;

      onViewportChangeStart?.(flowTransform);
      onMoveStart?.(event.sourceEvent as MouseEvent | TouchEvent, flowTransform);
    }
  };
}

export function createPanZoomHandler({
  zoomPanValues,
  panOnDrag,
  onPaneContextMenu,
  onTransformChange,
  onMove,
  onViewportChange,
}: PanZoomParams) {
  return (event: D3ZoomEvent<HTMLDivElement, any>) => {
    zoomPanValues.zoomedWithRightMouseButton = !!(
      onPaneContextMenu && isRightClickPan(panOnDrag, zoomPanValues.mouseButton ?? 0)
    );

    onTransformChange([event.transform.x, event.transform.y, event.transform.k]);

    if (onMove || onViewportChange) {
      const flowTransform = eventToFlowTransform(event.transform);

      onViewportChange?.(flowTransform);
      onMove?.(event.sourceEvent as MouseEvent | TouchEvent, flowTransform);
    }
  };
}

export function createPanZoomEndHandler({
  zoomPanValues,
  panOnDrag,
  panOnScroll,
  onDraggingChange,
  onMoveEnd,
  onViewportChangeEnd,
  onPaneContextMenu,
}: PanZoomEndParams) {
  return (event: D3ZoomEvent<HTMLDivElement, any>) => {
    zoomPanValues.isZoomingOrPanning = false;

    if (
      onPaneContextMenu &&
      isRightClickPan(panOnDrag, zoomPanValues.mouseButton ?? 0) &&
      !zoomPanValues.zoomedWithRightMouseButton &&
      event.sourceEvent
    ) {
      onPaneContextMenu(event.sourceEvent);
    }
    zoomPanValues.zoomedWithRightMouseButton = false;

    onDraggingChange(false);

    if ((onMoveEnd || onViewportChangeEnd) && viewChanged(zoomPanValues.prevTransform, event.transform)) {
      const flowTransform = eventToFlowTransform(event.transform);
      zoomPanValues.prevTransform = flowTransform;

      clearTimeout(zoomPanValues.timerId);
      zoomPanValues.timerId = setTimeout(
        () => {
          onViewportChangeEnd?.(flowTransform);
          onMoveEnd?.(event.sourceEvent as MouseEvent | TouchEvent, flowTransform);
        },
        panOnScroll ? 150 : 0
      );
    }
  };
}

export function createFilter({
  zoomActivationKeyPressed,
  zoomOnScroll,
  zoomOnPinch,
  panOnDrag,
  panOnScroll,
  zoomOnDoubleClick,
  userSelectionActive,
  noWheelClassName,
  noPanClassName,
}: FilterParams) {
  return (event: any): boolean => {
    const zoomScroll = zoomActivationKeyPressed || zoomOnScroll;
    const pinchZoom = zoomOnPinch && event.ctrlKey;

    if (
      event.button === 1 &&
      event.type === 'mousedown' &&
      (isWrappedWithClass(event, 'react-flow__node') || isWrappedWithClass(event, 'react-flow__edge'))
    ) {
      return true;
    }

    // if all interactions are disabled, we prevent all zoom events
    if (!panOnDrag && !zoomScroll && !panOnScroll && !zoomOnDoubleClick && !zoomOnPinch) {
      return false;
    }

    // during a selection we prevent all other interactions
    if (userSelectionActive) {
      return false;
    }

    // if zoom on double click is disabled, we prevent the double click event
    if (!zoomOnDoubleClick && event.type === 'dblclick') {
      return false;
    }

    // if the target element is inside an element with the nowheel class, we prevent zooming
    if (isWrappedWithClass(event, noWheelClassName) && event.type === 'wheel') {
      return false;
    }

    // if the target element is inside an element with the nopan class, we prevent panning
    if (isWrappedWithClass(event, noPanClassName) && event.type !== 'wheel') {
      return false;
    }

    if (!zoomOnPinch && event.ctrlKey && event.type === 'wheel') {
      return false;
    }

    // when there is no scroll handling enabled, we prevent all wheel events
    if (!zoomScroll && !panOnScroll && !pinchZoom && event.type === 'wheel') {
      return false;
    }

    // if the pane is not movable, we prevent dragging it with mousestart or touchstart
    if (!panOnDrag && (event.type === 'mousedown' || event.type === 'touchstart')) {
      return false;
    }

    // if the pane is only movable using allowed clicks
    if (
      Array.isArray(panOnDrag) &&
      !panOnDrag.includes(event.button) &&
      (event.type === 'mousedown' || event.type === 'touchstart')
    ) {
      return false;
    }

    // We only allow right clicks if pan on drag is set to right click
    const buttonAllowed =
      (Array.isArray(panOnDrag) && panOnDrag.includes(event.button)) || !event.button || event.button <= 1;

    // default filter for d3-zoom
    return (!event.ctrlKey || event.type === 'wheel') && buttonAllowed;
  };
}
