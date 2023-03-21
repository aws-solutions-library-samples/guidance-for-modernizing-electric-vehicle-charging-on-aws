# EV Charge Point Simulator
> We have provided the `simulate.py` Python script to help you test and explore the capability of OCPP Gateway and AWS IoT without the need for a physical EV Charge Point. Other OCPP simulators, like [OCPP-2.0-CP-Simulator](https://github.com/JavaIsJavaScript/OCPP-2.0-CP-Simulator), can also be used.


Current version: **1.0.0**

## 📋 Table of content

- [Tutorial](#-tutorial)
- [Requirements](#-requirements)
- [See Also](#-see-also)
- [Credits](#-credits)

## 🚀 Tutorial

> Before getting started, verify that this [list of pre-requisites](#-requirements) have been satisfied. 


### 1. Setup

- Open [AWS IoT Core console in the deployed region](https://console.aws.amazon.com/iot/home?#/thinghub) and click [**Create a things**](https://console.aws.amazon.com/iot/home?#/create/provisioning).

- Select **Create single thing** and hit **Next**

- Each EV Charge Point must map to a single IoT Thing. 
For our test we'll use as **Thing name** `CP1`

- Hit **Next** to create the IoT Thing

Navigate to this folder with your terminal:
```bash
cd ev-charge-point-simulator
```

Create a Python virtual environment and activate it by running:
```bash
python3 -m venv venv && source venv/bin/activate
```

Install the Python dependencies by running:

```bash
pip3 install -r requirements.txt
```


### 2. Simulate an EV Charge Point Boot and Heartbeat

The Python script simulates some basic functionality of an EV Charge Point:

1. Sending a `BootNotification` ([specification](https://raw.githubusercontent.com/mobilityhouse/ocpp/master/docs/v201/OCPP-2.0.1_part2_specification.pdf#bootnotification)), including attributes about the Charge Point hardware
2. Sending `Heartbeat` ([specification](https://raw.githubusercontent.com/mobilityhouse/ocpp/master/docs/v201/OCPP-2.0.1_part2_specification.pdf#heartbeat)) messages based on a frequency instructed by the Charge Point Operator (this is defined by the `interval` parameter returned in the response to the `BootNotification`)

Run the Python script using the following command, making sure to replace the `--url` value with the `AwsOcppGatewayStack.websocketURL` returned from the cdk deployment:
```bash
python3 simulate.py --url {websocket URL generated from the AWS OCPP Stack} --cp-id CP1 
```
> Note that we are using `--cp-id CP1` which must match the value of the IoT Thing created above. If the `--cp-id` doesn't match the IoT Thing name, the connection will be rejected by the OCPP Gateway.

A successful output should look like this:

```bash
(venv) ev-charge-point-simulator % python3 simulate.py --url {websocket URL generated from the AWS OCPP Stack} --cp-id CP1 
INFO:ocpp:CP1: send [2,"0678cb2a-a7a2-42bc-8037-d01164e77ac6","BootNotification",{"chargingStation":{"model":"ABC 123 XYZ","vendorName":"Acme Electrical Systems","firmwareVersion":"10.9.8.ABC","serialNumber":"CP1234567890A01","modem":{"iccid":"891004234814455936F","imsi":"310410123456789"}},"reason":"PowerUp"}]
INFO:ocpp:CP1: receive message [3,"0678cb2a-a7a2-42bc-8037-d01164e77ac6",{"currentTime":"2023-02-16T19:00:18.630818","interval":10,"status":"Accepted"}]
INFO:root:CP1: connected to central system
INFO:root:CP1: heartbeat interval set to 10
INFO:ocpp:CP1: send [2,"9b7933a7-5216-496d-9bb0-dae45014bb98","Heartbeat",{}]
INFO:ocpp:CP1: receive message [3,"9b7933a7-5216-496d-9bb0-dae45014bb98",{"currentTime":"2023-02-16T19:00:19.073675"}]
```

This exchange represents a successful simulation of an EV Charge Point, first sending a `BootNotification`, followed by subsequent `Heartbeat` at the specified interval. The output includes both the simulated OCPP message sent from the EV Charge Point to AWS IoT (prefixed `send`) and the response received from AWS (prefixed `received message`).


### 3. Simulate Different EV Charge Points

To simulate with a different EV Charge Point set a different value for the `--cp-id` argument.

**Note:** if the `--cp-id` value doesn't have a correspondent IoT Thing the OCPP Gateway will reject the connection. Here is an unsuccessful example passing `--cp-id CP2`, which is _not_ registered as a Thing in IoT:

```bash
(venv) ev-charge-point-simulator % python3 simulate.py --url {websocket URL generated from the AWS OCPP Stack} --cp-id CP2 
INFO:ocpp:CP2: send [2,"32dc5b6e-77b0-4105-b217-28e20b579ecc","BootNotification",{"chargingStation":{"model":"ABC 123 XYZ","vendorName":"Acme Electrical Systems","firmwareVersion":"10.9.8.ABC","serialNumber":"CP1234567890A01","modem":{"iccid":"891004234814455936F","imsi":"310410123456789"}},"reason":"PowerUp"}]
ERROR:root:CP2: received 1008 (policy violation) Charge Point CP2 not registered as an IoT Thing; then sent 1008 (policy violation) Charge Point CP2 not registered as an IoT Thing
```


### 4. Monitor OCPP Activity in the AWS IoT Console

Messages from and to the EV Charge Point are managed within AWS by IoT Core. These messages utilize the MQTT publish and subscribe protocol. To see these messages, open AWS IoT Core console in the deployed region and select **MQTT test client** (https://console.aws.amazon.com/iot/home?#/test).

In the test client subscribe to these two topics:

1. To view all messages from EV Charge Point to AWS
```bash
+/in
```

2. To view all messages from AWS to EV Charge Point
```bash
+/out
```

Run the Python script to simulate an EV Charge Point and see the messages in the MQTT test client.


### 5. Track EV Charge Point Hardware Attributes in Device Shadows

When an EV Charge Point sends a `BootNotification` its hardware attributes are stored in a Device Shadow associated with the IoT Thing. To see these attributes, open AWS IoT Core console in the deployed region and navigate to **Things** (https://console.aws.amazon.com/iot/home?#/thing). Select the IoT Thing created previously and then the **Device Shadows** tab. Click the **Classic Shadow** to see the Device Shadow document and the hardware attributes reported by the EV Charge Point.

```json
{
  "state": {
    "reported": {
      "chargingStation": {
        "model": "ABC 123 XYZ",
        "vendorName": "Acme Electrical Systems",
        "firmwareVersion": "10.9.8.ABC",
        "serialNumber": "CP1234567890A01",
        "modem": {
          "iccid": "891004234814455936F",
          "imsi": "310410123456789"
        }
      },
      "reason": "PowerUp"
    }
  }
}
```

Simulate different EV Charge Point hardware attributes by passing these arguments into the Python script and verify their affect on the Device Shadow:

- `--cp-serial` - to set the serial number
- `--cp-model` - to set the model identification
- `--cp-version` - to set the firmware version
- `--cp-vendor` - to set the vendor name


## Try Yourself

This section provides some suggestions of simulations and tests you can do yourself to better appreciate the *art of the possible* as it relates to building an OCPP-compliant EV Charge Point management solution on AWS.

### Load Testing

AWS IoT is a fully managed, highly elastic service that scales to support millions of Things. The OCPP Gateway uses auto-scaling technology to automatically grow as your fleet of EV Charge Points grows. Using a load testing tool or the included Apache JMeter configuration, simulate a load of thousands of EV Charge Points. Check the ECS console to see how the number of tasks increases from one to two, etc. as your load increases. **Note**: auto-scaling is configured to trigger when the average CPU utilization exceeds 60% -- you can drive more load or decrease this threshold to test the affect.

### IoT Rules

IoT Rules can be used to filter MQTT messages and route them to other services in AWS. Create a new rule to capture `Heartbeat` messages and record them in a DynamoDB table for a last known event.

Create a DynamoDB table with a partition key `chargePointId` and an IoT rule using the SQL query below. Set the DynamoDBv2 action to point to your DynamoDB table.

```sql
SELECT 
  topic(1) AS chargePointId,
  timestamp() AS lastTimestamp
FROM '+/in'
WHERE get(*, 2) = 'Heartbeat'
```

Watch the DynamoDB table populate and update as new heartbeat messages are received.

### Connection Handling

A single EV Charge Point must only maintain one connection to the OCPP Gateway, otherwise routing of responses from the Charge Point management solution to the right connection may be affected. You can simulate a reconnection attempt by using the `wscat` (https://www.npmjs.com/package/wscat) utility.

Open a terminal windows and establish a WebSocket connection:

```bash
wscat -c {AwsOcppGatewayStack.websocketURL}/CP1 -s ocpp2.0.1
Connected (press CTRL+C to quit)
>
```

The connection is establish. Now in a second terminal session run the same command, attempting to create another connection using the same EV Charge Point, e.g. `CP1`. Once this new connection is established you'll see that the prior connection is closed automatically:

```bash
Disconnected (code: 1000, reason: "")
```

Similarly, testing a connection with an EV Charge Point ID that is not configured as an IoT Thing will result in the connection attempt being rejected:

```bash
wscat -c {AwsOcppGatewayStack.websocketURL}/CPX -s ocpp2.0.1
Connected (press CTRL+C to quit)
Disconnected (code: 1008, reason: "Charge Point CPX not registered as an IoT Thing")
```


## Wrap Up
When you are done running simulations, deactivate the Python virtual environment (`venv`) by executing this command in your terminal:

```bash
deactivate
```


## 🎒 Pre-requisites
- Have console access to your AWS account
- Have already deployed the [OCPP Stack](../README.md)
- [Python 3+](https://www.python.org) installed on your machine. ([Instructions](https://www.python.org/downloads/))



## 👏 Credits
This sample was made possible thanks to the following libraries:
- [ocpp](https://github.com/mobilityhouse/ocpp) from [Mobility House](https://github.com/mobilityhouse)