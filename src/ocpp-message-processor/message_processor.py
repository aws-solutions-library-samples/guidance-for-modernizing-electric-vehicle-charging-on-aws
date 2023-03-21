import json
import boto3
import os
import ocpp.messages

from datetime import datetime

from ocpp.v201.enums import Action
from ocpp.v201.enums import RegistrationStatusType

iot = boto3.client("iot-data", region_name=os.environ["AWS_REGION"])


def lambda_handler(event, _):
    print(event)
    print(f"{event=}")
    for record in event["Records"]:
        print(f"{record=}")
        handle_record(record)

    return


def handle_record(record):
    body = json.loads(record["body"])
    charge_point_id = body["chargePointId"]
    message = ocpp.messages.unpack(json.dumps(body["message"]))

    handle_charge_point_message(charge_point_id, message)


def handle_charge_point_message(charge_point_id, message):
    print(f"{message.action=} received from {charge_point_id=}")

    if message.action == Action.BootNotification:
        return handle_boot_notification(charge_point_id, message)
    elif message.action == Action.Heartbeat:
        return handle_heartbeat(charge_point_id, message)
    elif message.action == Action.StatusNotification:
        return handle_status_notification(charge_point_id, message)

    return handle_unsupported_message(charge_point_id, message)


def handle_boot_notification(charge_point_id, message):
    update_charge_point_shadow(charge_point_id, message.payload)

    response = message.create_call_result(
        {
            "currentTime": datetime.utcnow().isoformat(),
            "interval": 10,  # set default interval period in seconds
            "status": RegistrationStatusType.accepted,
        }
    )
    return send_message_to_charge_point(charge_point_id, response)


def handle_heartbeat(charge_point_id, message):
    response = message.create_call_result(
        {"currentTime": datetime.utcnow().isoformat()}
    )

    return send_message_to_charge_point(charge_point_id, response)


def handle_status_notification(charge_point_id, message):
    response = message.create_call_result({})

    return send_message_to_charge_point(charge_point_id, response)


def handle_unsupported_message(charge_point_id, message):
    response = message.create_call_result(
        {"error": f"Command [{message.action}] not implemented."}
    )

    return send_message_to_charge_point(charge_point_id, response)


def update_charge_point_shadow(charge_point_id, message):
    iot_request = {
        "topic": f"$aws/things/{charge_point_id}/shadow/update",
        "qos": 1,
        "payload": json.dumps({"state": {"reported": message}}),
    }
    print(f"{iot_request=}")

    iot_response = iot.publish(**iot_request)
    print(f"{iot_response=}")

    return iot_response


def send_message_to_charge_point(charge_point_id, message):
    iot_request = {
        "topic": f"{charge_point_id}/out",
        "qos": 1,
        "payload": message.to_json(),
    }
    print(f"{iot_request=}")

    iot_response = iot.publish(**iot_request)
    print(f"{iot_response=}")

    return iot_response
