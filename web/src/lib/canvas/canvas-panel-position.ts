export type VerticalBounds = {
    top: number;
    bottom: number;
};

export function getVerticalViewportCorrection(panel: VerticalBounds, container: VerticalBounds, padding = 12) {
    const topBoundary = container.top + padding;
    const bottomBoundary = container.bottom - padding;
    const panelHeight = panel.bottom - panel.top;
    const availableHeight = bottomBoundary - topBoundary;

    if (panelHeight > availableHeight) return topBoundary - panel.top;
    if (panel.bottom > bottomBoundary) return bottomBoundary - panel.bottom;
    if (panel.top < topBoundary) return topBoundary - panel.top;
    return 0;
}
