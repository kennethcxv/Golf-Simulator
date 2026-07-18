export function createCourseWaterReflectionGuard() {
  let reflectionActive = false;
  let frameId = 0;
  const reflectedFrameByWater = new WeakMap();

  const guardCourseWaterReflection = function guardCourseWaterReflection(water) {
    if (!water || typeof water.onBeforeRender !== 'function') {
      throw new TypeError('Course water requires an onBeforeRender reflection callback');
    }

    const renderReflection = water.onBeforeRender;
    water.onBeforeRender = function renderWithoutNestedCourseWaterReflections(...args) {
      // EffectComposer traverses the scene once for its RenderPass and again
      // while GTAO builds its buffers. The Water addon otherwise refreshes the
      // same 512px reflection target on every traversal even though the camera
      // and world state have not advanced between them.
      if (reflectionActive || reflectedFrameByWater.get(water) === frameId) return undefined;
      reflectionActive = true;
      try {
        const result = renderReflection.apply(this, args);
        reflectedFrameByWater.set(water, frameId);
        return result;
      } finally {
        reflectionActive = false;
      }
    };
    return water;
  };

  guardCourseWaterReflection.beginFrame = () => {
    frameId += 1;
  };

  return guardCourseWaterReflection;
}
