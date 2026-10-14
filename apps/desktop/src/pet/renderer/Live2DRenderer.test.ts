
import { patchRenderOrders } from "./Live2DRenderer";
import { describe as d2, it as i2, expect as e2 } from "vitest";
d2("patchRenderOrders", () => {
  i2("adds renderOrders from drawOrders when Core lacks it", () => {
    const drawables: any = { count: 3, drawOrders: new Int32Array([500, 100, 300]) };
    const m = { internalModel: { coreModel: { _model: { drawables } } } };
    patchRenderOrders(m);
    e2(Array.from(drawables.renderOrders)).toEqual([2, 0, 1]);
  });
  i2("uses getRenderOrders when available", () => {
    const drawables: any = { count: 2, drawOrders: new Int32Array([1, 2]) };
    const m = { internalModel: { coreModel: { _model: { drawables, getRenderOrders: () => new Int32Array([1, 0]) } } } };
    patchRenderOrders(m);
    e2(Array.from(drawables.renderOrders)).toEqual([1, 0]);
  });
});
