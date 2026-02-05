function getBubbleWindowBoundsFromMain(mainBounds, bubbleSize, offset = { x: 0, y: 12 }) {
  if (!mainBounds || !bubbleSize) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const offsetX = Number.isFinite(offset.x) ? offset.x : 0;
  const offsetY = Number.isFinite(offset.y) ? offset.y : 12;
  const centerX = mainBounds.x + mainBounds.width / 2;
  const x = Math.round(centerX - bubbleSize.width / 2 + offsetX);
  const y = Math.round(mainBounds.y - bubbleSize.height - offsetY);
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: bubbleSize.width,
    height: bubbleSize.height
  };
}

module.exports = {
  getBubbleWindowBoundsFromMain
};
