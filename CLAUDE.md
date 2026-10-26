# rainbird – project rules

@/mnt/devel/homeProjects/codingRules/CLAUDE.md
@/mnt/devel/homeProjects/codingRules/rules/workflow-git.md
@/mnt/devel/homeProjects/codingRules/rules/testing.md
@/mnt/devel/homeProjects/codingRules/rules/scripts.md
@/mnt/devel/homeProjects/codingRules/rules/node.md

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
