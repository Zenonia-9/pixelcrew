import test from 'node:test';
import assert from 'node:assert/strict';
import {clampCameraZoom,zoomAtCursor} from '../shared/office-camera';

test('zoom preserves the world point under the pointer without moving the viewport',()=>{
  const viewport={x:800,y:500},cursor={x:167,y:321},pan={x:34,y:-12};
  const oldZoom=.8,newZoom=1.7;
  const next=zoomAtCursor(pan,oldZoom,newZoom,cursor,viewport);
  const before={x:(cursor.x-viewport.x/2-pan.x)/oldZoom,y:(cursor.y-viewport.y/2-pan.y)/oldZoom};
  const after={x:(cursor.x-viewport.x/2-next.x)/newZoom,y:(cursor.y-viewport.y/2-next.y)/newZoom};
  assert.ok(Math.abs(before.x-after.x)<1e-9);
  assert.ok(Math.abs(before.y-after.y)<1e-9);
  assert.deepEqual(viewport,{x:800,y:500});
});
test('camera limits support close inspection and a complete small-window overview',()=>{
  assert.equal(clampCameraZoom(.01),.2);
  assert.equal(clampCameraZoom(8),3);
  assert.equal(clampCameraZoom(1.34),1.34);
});
