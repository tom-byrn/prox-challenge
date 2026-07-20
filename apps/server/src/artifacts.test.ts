import assert from "node:assert/strict";
import test from "node:test";
import { ArtifactContextSchema, artifactRevision, validateArtifactContent } from "./artifacts.js";

const existing = ArtifactContextSchema.parse({
  identifier: "settings-configurator",
  title: "Settings configurator",
  type: "application/vnd.ant.react",
  content: "export default function App() { return <main>Revision one</main>; }",
  revision: 1
});

test("artifact identifiers create stable full-content revisions", () => {
  assert.deepEqual(artifactRevision([], "settings-configurator", "application/vnd.ant.react"), { revision: 1, operation: "created" });
  assert.deepEqual(artifactRevision([existing], "settings-configurator", "application/vnd.ant.react"), { revision: 2, operation: "updated" });
  assert.throws(
    () => artifactRevision([existing], "settings-configurator", "text/html"),
    /already uses type application\/vnd\.ant\.react/
  );
});

test("active artifacts reject network, storage, embedding, and module imports", () => {
  assert.equal(validateArtifactContent("text/html", "<button>Safe</button><script>document.body.dataset.ok='yes'</script>"), undefined);
  assert.match(validateArtifactContent("text/html", "<script>fetch('/secret')</script>") ?? "", /forbidden network/);
  assert.match(validateArtifactContent("application/vnd.ant.react", "import React from 'react'; export default () => <div />") ?? "", /cannot import modules/);
  assert.match(validateArtifactContent("application/vnd.ant.react", "export default () => <iframe />") ?? "", /forbidden network/);
});

test("document artifacts remain inert but cannot link externally", () => {
  assert.equal(validateArtifactContent("text/markdown", "# Setup\n\nUse the selector below."), undefined);
  assert.match(validateArtifactContent("text/markdown", "[external](https://example.com)") ?? "", /cannot load or link/);
});
