import json
import boto3
import os

dynamodb = boto3.resource("dynamodb", region_name=os.environ["AWS_REGION"])
charge_point_table = dynamodb.Table(os.environ["DYNAMODB_CHARGE_POINT_TABLE"])


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

    return charge_point_table.delete_item(Key={"chargePointId": charge_point_id})
