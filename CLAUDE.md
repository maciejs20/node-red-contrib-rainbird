# rainbird – project rules

@docs/coding-rules/CLAUDE.md
@docs/coding-rules/rules/workflow-git.md
@docs/coding-rules/rules/writing.md
@docs/coding-rules/rules/testing.md
@docs/coding-rules/rules/scripts.md
@docs/coding-rules/rules/node.md

Imports: the shared rule set is the git submodule `docs/coding-rules` (op. 2026-11-25); update it with
`git submodule update --remote docs/coding-rules` and commit the new pointer; never edit it here.

## Project facts

- Purpose: Node-RED nodes for Rain Bird irrigation controllers via local LNK2 (SIP) and the IQ4 cloud (package
  `node-red-contrib-rainbird` 1.1.0).
- Node: `engines >=16.0.0` (to be pinned to a current LTS); module system: CommonJS; no Docker, no own web GUI
  (Node-RED editor `.html` files per node).
- Entry: `index.js` / `node-rainbird.js`; one `rainbird-*.js` + `.html` pair per node;
  protocol `rainbird-sip-commands.js`,
  IQ4 client `rainbird-iq4-client.js`.
- Scripts: `npm test`.
- Docs: `README.md`, `docs/{SIP_PROTOCOL,IQ4_PROTOCOL,IQ4_CLOUD_STATUS}.md`, `CHANGELOG.txt`, `examples/`.
- External systems: Rain Bird controller with LNK2 module (tested ESP-me3, ESP-RZXe), Rain Bird IQ4 cloud.
- Remote: `origin`.

## Project overrides

- Override of the node-docker template: Node-RED node library, not a container service; `docker-startup.md`,
  `startup-portal.md`, `web-gui.md` not imported.
- `sms-alerts.md` not imported: a node library has no process or notification channel of its own; it reports
  faults as node status and error messages, and the Node-RED flow that uses the nodes holds the notification path
  (hand-over, core §10).
