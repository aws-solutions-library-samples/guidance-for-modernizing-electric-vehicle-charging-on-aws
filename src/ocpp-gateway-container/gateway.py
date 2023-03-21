import asyncio_mqtt
import boto3
import logging
import os
import ssl

logging.basicConfig(level=logging.ERROR)

dynamodb = boto3.resource("dynamodb", region_name=os.environ["AWS_REGION"])
charge_point_table = dynamodb.Table(os.environ["DYNAMODB_CHARGE_POINT_TABLE"])


class ChargePointDoesNotExist(Exception):
    pass


class Gateway(asyncio_mqtt.Client):
    """
    Gateway is a wrapper around asyncio_mqtt.Client that handles the connection to IoT Core
    and the relaying of messages to and from the websocket connection, allowing the exchange
    of OCPP messages between the charge point and the cloud.
    """

    def __init__(self, charge_point_id, websocket_connection):
        self.charge_point_id = charge_point_id
        self.websocket_connection = websocket_connection
        self.ssl = self.create_ssl_context()
        self.hostname = os.environ["IOT_ENDPOINT"]
        self.port = int(os.environ["IOT_PORT"])

        if not self.charge_point_exists():
            error = (
                f"Charge Point {self.charge_point_id} not registered as an IoT Thing"
            )
            raise ChargePointDoesNotExist(error)

        super().__init__(
            self.hostname,
            self.port,
            client_id=self.charge_point_id,
            tls_context=self.ssl,
        )

    def charge_point_exists(self):
        """
        Check if the charge point has been registered as an IoT Thing
        If not, raise a ChargePointDoesNotExist exception
        whicn results in closing the websocket connection and not attempting
        to connect to IoT Core to avoid unnecessary traffic nor polluting
        the IoT topic
        """
        dynamo_db_response = charge_point_table.get_item(
            Key={"chargePointId": self.charge_point_id}
        )

        return "Item" in dynamo_db_response

    def create_ssl_context(self):
        """Creates an SSL context for the MQTT client"""
        context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH)
        context.verify_mode = ssl.CERT_REQUIRED
        context.load_verify_locations(cafile="/etc/iot-certificates/AmazonRootCA1.pem")
        context.load_cert_chain(
            certfile="/etc/iot-certificates/iot.pem",
            keyfile="/etc/iot-certificates/iot.key",
        )
        context.tls_version = ssl.PROTOCOL_TLSv1_2
        context.ciphers = None
        return context

    async def relay(self, topic):
        """Relays a message from IoT Core topic to a websocket"""
        async with self.messages() as messages:
            await self.subscribe(topic)
            async for message in messages:
                await self.websocket_connection.send(message.payload.decode())

    async def forward(self, topic):
        """Forwards a message from the websocket to the IoT Core topic"""
        while True:
            message = await self.websocket_connection.recv()
            await self.publish(topic, payload=message)
