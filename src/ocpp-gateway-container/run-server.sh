#!/bin/bash
echo "$IOT_AMAZON_ROOT_CA"      > /home/appuser/iot-certificates/AmazonRootCA1.pem
echo "$IOT_GATEWAY_PUBLIC_KEY"  > /home/appuser/iot-certificates/iot.pub
echo "$IOT_GATEWAY_PRIVATE_KEY" > /home/appuser/iot-certificates/iot.key
echo "$IOT_GATEWAY_CERTIFICATE" > /home/appuser/iot-certificates/iot.pem
echo "Successfully set IOT certificates"

echo "Starting the gateway server"
cd /home/appuser/ocpp-gateway
source bin/activate
exec python3.10 server.py
