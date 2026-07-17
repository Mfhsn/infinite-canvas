import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import type { UploadedImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type ReferenceImageInputOptions = {
    targetNode: CanvasNodeData;
    image: UploadedImage;
    title: string;
    index: number;
    nodeId: string;
    connectionId: string;
};

export function buildReferenceImageInput({ targetNode, image, title, index, nodeId, connectionId }: ReferenceImageInputOptions): { node: CanvasNodeData; connection: CanvasConnection } {
    const size = fitNodeSize(image.width, image.height, 160, 120);
    return {
        node: {
            id: nodeId,
            type: CanvasNodeType.Image,
            title,
            position: {
                x: targetNode.position.x - size.width - 84,
                y: targetNode.position.y + index * 144,
            },
            width: size.width,
            height: size.height,
            metadata: {
                content: image.url,
                storageKey: image.storageKey,
                status: "success",
                naturalWidth: image.width,
                naturalHeight: image.height,
                bytes: image.bytes,
                mimeType: image.mimeType,
            },
        },
        connection: { id: connectionId, fromNodeId: nodeId, toNodeId: targetNode.id },
    };
}
