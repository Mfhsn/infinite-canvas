import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Copy, Image as ImageIcon, List, Music2, Settings2, Trash2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type ContextMenuState } from "@/types/canvas";
import { useI18n } from "@/i18n/use-i18n";

type GenerationNodeType = CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio;

export function CanvasNodeContextMenu({ menu, onClose, onDuplicate, onDelete, onCreateNode }: { menu: ContextMenuState; onClose: () => void; onDuplicate: () => void; onDelete: () => void; onCreateNode: (type: GenerationNodeType) => void }) {
    const { t } = useI18n();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ x: menu.x, y: menu.y });

    useLayoutEffect(() => {
        const element = menuRef.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const padding = 8;
        const next = {
            x: Math.min(Math.max(padding, menu.x), Math.max(padding, window.innerWidth - rect.width - padding)),
            y: Math.min(Math.max(padding, menu.y), Math.max(padding, window.innerHeight - rect.height - padding)),
        };
        setPosition((current) => (current.x === next.x && current.y === next.y ? current : next));
    }, [menu.type, menu.x, menu.y]);

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            ref={menuRef}
            className="fixed z-[120] min-w-52 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: position.x, top: position.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {menu.type === "canvas" ? (
                <>
                    <div className="px-3 pb-1 pt-2 text-[11px] font-medium" style={{ color: theme.node.muted }}>
                        {t("canvas.contextMenu.generateNode")}
                    </div>
                    <MenuButton icon={<List className="size-4" />} label={t("canvas.connectionCreate.text")} onClick={() => onCreateNode(CanvasNodeType.Text)} />
                    <MenuButton icon={<ImageIcon className="size-4" />} label={t("canvas.connectionCreate.image")} onClick={() => onCreateNode(CanvasNodeType.Image)} />
                    <MenuButton icon={<Video className="size-4" />} label={t("canvas.connectionCreate.video")} onClick={() => onCreateNode(CanvasNodeType.Video)} />
                    <MenuButton icon={<Music2 className="size-4" />} label={t("canvas.connectionCreate.audio")} onClick={() => onCreateNode(CanvasNodeType.Audio)} />
                    <MenuButton icon={<Settings2 className="size-4" />} label={t("canvas.connectionCreate.config")} onClick={() => onCreateNode(CanvasNodeType.Config)} />
                </>
            ) : (
                <>
                    {menu.type === "node" ? <MenuButton icon={<Copy className="size-4" />} label={t("common.duplicateNode")} onClick={onDuplicate} /> : null}
                    <MenuButton icon={<Trash2 className="size-4" />} label={t("common.delete")} onClick={onDelete} danger />
                </>
            )}
        </div>
    );
}

function MenuButton({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80" style={{ color: danger ? "#f87171" : theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
