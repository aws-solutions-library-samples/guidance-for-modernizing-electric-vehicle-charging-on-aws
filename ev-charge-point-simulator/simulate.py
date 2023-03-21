import argparse
import asyncio
import logging
import websockets

from ocpp.v201 import call
from ocpp.v201 import ChargePoint as cp
from ocpp.v201.enums import RegistrationStatusType


logging.basicConfig(level=logging.INFO)


class ChargePointSimlator(cp):
    async def send_boot_notification(self):
        request = call.BootNotificationPayload(
            charging_station={
                "serial_number": arguments["cp_serial"],
                "model": arguments["cp_model"],
                "vendor_name": arguments["cp_vendor"],
                "firmware_version": arguments["cp_version"],
                "modem": {"iccid": "891004234814455936F", "imsi": "310410123456789"},
            },
            reason="PowerUp",
        )
        response = await self.call(request)

        if response.status == RegistrationStatusType.accepted:
            logging.info("%s: connected to central system", arguments["cp_id"])
            if response.interval:
                arguments["heartbeat_interval"] = response.interval
                logging.info(
                    "%s: heartbeat interval set to %s",
                    arguments["cp_id"],
                    response.interval,
                )

        return True

    async def send_commands(self, arguments):
        await self.send_boot_notification()
        await self.send_heartbeats(arguments)

    async def send_heartbeats(self, arguments):
        while True:
            request = call.HeartbeatPayload()
            await self.call(request)
            await asyncio.sleep(arguments["heartbeat_interval"])


async def main(arguments):
    try:
        async with websockets.connect(
            f"{arguments['url']}/{arguments['cp_id']}",
            subprotocols=["ocpp2.0.1"],
        ) as ws:
            cp = ChargePointSimlator(arguments["cp_id"], ws)
            await asyncio.gather(cp.start(), cp.send_commands(arguments))
    except Exception as e:
        logging.error("%s: %s", arguments["cp_id"], e)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", help="The NLB URL", required=True)
    parser.add_argument(
        "--cp-id", help="The Charge Point ID", default="CP1", required=False
    )
    parser.add_argument(
        "--cp-model",
        help="The Change Point model",
        default="CHARGE_POINT_MODEL",
        required=False,
    )
    parser.add_argument(
        "--cp-vendor",
        help="The Change Point vendor name",
        default="CHARGE_POINT_VENDOR",
        required=False,
    )
    parser.add_argument(
        "--cp-version",
        help="The Change Point firmware version",
        default="1.2.3.4",
        required=False,
    )
    parser.add_argument(
        "--cp-serial",
        help="The Change Point serial number",
        default="CP1234567890A01",
        required=False,
    )

    arguments = vars(parser.parse_args())
    asyncio.run(main(arguments))
