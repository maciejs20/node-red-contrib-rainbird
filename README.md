This set of nodes enables communication with the Rainbird LNK2 sprinkler controller via a local LNK2 connection. To use these nodes, you need both the Rainbird controller and the LNK2 add-on properly plugged in and configured.

### Prerequisites

To connect, you need the **LNK2 IP address** and **PIN**:

* **LNK2 PIN**: This is the code you set up in the Rainbird mobile app when configuring the LNK2.
* **LNK2 IP**: This is the local IP address assigned by your router.

This package wraps the functionality of [node-rainbird](https://github.com/bbreukelen/node-rainbird) and exposes Rainbird LNK2 functions to Node-RED.

### Available Nodes:

#### **rainbird-info**

Fetches basic information about the Rainbird sprinkler controller via the local LNK2 connection. The payload returned contains the following:

```json
{
  "serialNumber": "xxxxxxxxxx",
  "modelID": "xxxxx",
  "protocolRevisionMajor": "xx",
  "protocolRevisionMinor": "xx",
  "hour": 13,
  "minute": 21,
  "second": 19,
  "day": 25,
  "month": 5,
  "year": 2025,
  "pageNumber": "00",
  "stationsAvail": 10
}
```

#### **rainbird-state**

Retrieves the current **IrrigationState** from the Rainbird sprinkler controller. The payload will contain:

```json
{
  "irrigationState": "_state_"
}
```

The **irrigationState** indicates whether the Rainbird controller is running a program. This does not provide information on active zones.

#### **rainbird-active**

Fetches information on active zones (sprinklers) from the Rainbird sprinkler controller. The returned payload will include:

```json
{
  "pageNumber": "00",
  "activeStations": "00000000",
  "activeZones": [0, 0, 0, 0]
}
```
New Feature – HomeKit Mode:
In "homekit" mode, this node detects changes in zone state and outputs only those zones that have changed. The output is formatted in a way compatible with HomeKit NRCHKB "Valve" node:
```json
{
  "payload": {
    "Active": 1,
    "InUse": 1
  },
  "topic": "2"
}
```

#### **rainbird-config**

Configuration node for managing the controller's setup.

#### **rainbird-startZone**

Manually activates a specific zone for a set duration (in minutes). If another zone is already active, it will be deactivated. It accepts message:
```json
{
  "payload": { "Active": 1 },
  "topic": "zone_nr",
  "time": "time_in_minutes"
}
```
where

* **msg.topic**: Specifies which zone to activate.
* **msg.time**: Defines how long the zone should run (in minutes).
* **msg.payload.Active**: Is a key that confirms that we want to start this zone.
Additionally, if a message contains:

```json
{ 
  "payload": 
    { "SetDuration": <time_in_seconds> }, 
  "topic": "zone_nr" }
```
The duration is stored for that zone and will be used for future activations. This enables direct integration with HomeKit valve controls.

#### **rainbird-stopZone**

Stops all sprinkler zones, halting irrigation.

#### **rainbird-delayStart**

Delays the start of an irrigation program by a specified number of days. The delay duration is provided in **msg.payload**.

#### **rainbird-startProgram**

Manually starts a program by specifying the program number in **msg.payload** (e.g., Program "A" = 1, Program "B" = 2). This feature is not supported on ESP-RZXe but works on ESP-me3 and may work on other models.

#### **rainbird-getDelay**

Retrieves information on whether a program's start has been delayed. The payload will return:

```json
{
  "delaySetting": number_of_days
}
```

### Example Flow

An example flow is provided in the **examples** folder of the repository. This flow demonstrates how to integrate and use the available Rainbird nodes within a Node-RED environment.

## Credits

This package uses a modified version of [node-rainbird](https://github.com/bbreukelen/node-rainbird) originally developed by @bbreukelen. All protocol decoding and encryption logic is based on that excellent work.


---

Maciej Szulc, 2025


