import logging
import os

import asyncio
import asyncio_mqtt
import websockets

import gateway

logging.basicConfig(format="%(message)s", level=logging.ERROR)

OCPP_PROTOCOLS = os.environ["OCPP_PROTOCOLS"].split(",")
OCPP_GATEWAY_PORT = int(os.environ["OCPP_GATEWAY_PORT"])


async def handler(websocket, path):
    if "Sec-WebSocket-Protocol" not in websocket.request_headers:
        logging.info("Client hasn't requested any Subprotocol. " "Closing Connection")
        return await websocket.close()

    requested_protocols = websocket.request_headers["Sec-WebSocket-Protocol"]
    if not websocket.subprotocol:
        logging.error(
            f"Protocols Mismatched | Expected Subprotocols: {websocket.available_subprotocols},"
            f" but client supports {requested_protocols} | Closing connection",
        )
        return await websocket.close()

    logging.info(f"Protocols Matched: {websocket.subprotocol}")
    charge_point_id = path.strip("/")

    try:
        async with gateway.Gateway(charge_point_id, websocket) as iot_connection:
            await asyncio.gather(
                iot_connection.forward(f"{charge_point_id}/in"),
                iot_connection.relay(f"{charge_point_id}/out"),
            )

    except gateway.ChargePointDoesNotExist as e:
        logging.error(e)
        return await websocket.close(1008, str(e))

    except (
        asyncio_mqtt.error.MqttError,
        asyncio_mqtt.error.MqttCodeError,
        websockets.exceptions.ConnectionClosedOK,
        websockets.exceptions.ConnectionClosedError,
        websockets.exceptions.ConnectionClosed,
        websockets.exceptions.InvalidHandshake,
        websockets.exceptions.WebSocketException,
    ) as e:
        logging.error(e)
        return await websocket.close()


async def main():
    server = await websockets.serve(
        handler, "0.0.0.0", OCPP_GATEWAY_PORT, subprotocols=OCPP_PROTOCOLS
    )
    await server.wait_closed()


if __name__ == "__main__":
    asyncio.run(main())
