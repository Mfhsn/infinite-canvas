import { describe, expect, test } from "bun:test";

import { CollectionRevisionTracker, collectionUsesOrder, orderCollectionDocuments, parsePersistedCollection, serializePersistedCollection } from "@/services/storage/persisted-collection";

describe("MySQL collection document mapping", () => {
    test("reconstructs Zustand canvas state from individual MySQL documents", () => {
        const projects = [
            { id: "project-1", title: "One" },
            { id: "project-2", title: "Two" },
        ];
        expect(parsePersistedCollection(serializePersistedCollection(projects, "projects"), "projects")).toEqual(projects);
    });

    test("keeps asset records in their own collection field", () => {
        const assets = [{ id: "asset-1", kind: "image" }];
        const serialized = serializePersistedCollection(assets, "assets");
        expect(parsePersistedCollection(serialized, "assets")).toEqual(assets);
        expect(parsePersistedCollection(serialized, "projects")).toEqual([]);
    });

    test("supports the independent folder envelope without collection order", () => {
        const folders = [{ id: "folder-1", name: "Folder", parentId: null }];
        expect(parsePersistedCollection(serializePersistedCollection(folders, "folders"), "folders")).toEqual(folders);
        expect(collectionUsesOrder("folders")).toBeFalse();
        expect(collectionUsesOrder("projects")).toBeTrue();
    });

    test("rejects records without stable ids", () => {
        expect(() => parsePersistedCollection(JSON.stringify({ state: { projects: [{ title: "missing" }] } }), "projects")).toThrow("require an id");
    });

    test("writes only local changes using the revision loaded by this browser", () => {
        const tracker = new CollectionRevisionTracker();
        tracker.hydrate([
            { key: "project-1", payload: { id: "project-1", title: "One" }, revision: 4, createdAt: "", updatedAt: "" },
            { key: "project-2", payload: { id: "project-2", title: "Two" }, revision: 7, createdAt: "", updatedAt: "" },
        ]);
        const plan = tracker.plan([
            { id: "project-1", title: "One" },
            { id: "project-2", title: "Changed locally" },
            { id: "project-3", title: "New" },
        ]);
        expect(plan.deleted).toEqual([]);
        expect(plan.changed.map(({ item, revision }) => ({ id: item.id, revision }))).toEqual([
            { id: "project-2", revision: 7 },
            { id: "project-3", revision: null },
        ]);
    });

    test("restores the exact persisted project order", () => {
        const documents = [
            { key: "project-1", payload: { id: "project-1", createdAt: "2026-01-01" } },
            { key: "project-2", payload: { id: "project-2", createdAt: "2026-02-01" } },
        ];
        expect(orderCollectionDocuments(documents, ["project-1", "project-2"]).map((document) => document.key)).toEqual(["project-1", "project-2"]);
    });
});
