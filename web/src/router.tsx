import { createBrowserRouter, Outlet } from "react-router-dom";

import { ENV_SHOW_IMAGE_WORKBENCH, ENV_SHOW_VIDEO_WORKBENCH } from "@/constant/env";
import { APP_ROUTER_BASENAME } from "@/lib/app-base-path";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import VideoPage from "@/pages/video";

export const router = createBrowserRouter(
    [
        {
            element: (
                <UserLayout>
                    <Outlet />
                </UserLayout>
            ),
            children: [
                { path: "/", element: <HomePage /> },
                ...(ENV_SHOW_IMAGE_WORKBENCH ? [{ path: "/image", element: <ImagePage /> }] : []),
                ...(ENV_SHOW_VIDEO_WORKBENCH ? [{ path: "/video", element: <VideoPage /> }] : []),
                { path: "/assets", element: <AssetsPage /> },
                { path: "/prompts", element: <PromptsPage /> },
                { path: "/canvas", element: <CanvasPage /> },
                { path: "/canvas/:id", element: <CanvasProjectPage /> },
            ],
        },
        { path: "*", element: <NotFound /> },
    ],
    { basename: APP_ROUTER_BASENAME },
);
