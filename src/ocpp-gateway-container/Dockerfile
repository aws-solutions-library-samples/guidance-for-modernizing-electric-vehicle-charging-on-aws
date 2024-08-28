FROM amazonlinux:2022

RUN yum update -y
RUN yum groupinstall "Development Tools" -y
RUN yum install openssl-libs -y
RUN yum install python3.10 python3.10-devel -y
RUN yum install cronie cronie-anacron -y

RUN useradd -ms /bin/bash appuser

RUN mkdir /home/appuser/ocpp-gateway
RUN mkdir /home/appuser/iot-certificates/
RUN chown appuser /home/appuser/ocpp-gateway
RUN chown appuser /home/appuser/iot-certificates

COPY ./ /home/appuser/ocpp-gateway/
RUN chmod +x /home/appuser/ocpp-gateway/run-server.sh

USER appuser

RUN python3.10 -m venv /home/appuser/ocpp-gateway/
RUN . /home/appuser/ocpp-gateway/bin/activate && pip install -r /home/appuser/ocpp-gateway/requirements.txt

EXPOSE 8080

ENTRYPOINT /home/appuser/ocpp-gateway/run-server.sh
CMD /home/appuser/ocpp-gateway/run-server.sh

HEALTHCHECK --interval=150s --timeout=30s --start-period=300s --start-interval=150s CMD curl --fail http://localhost:8080 || exit 1
