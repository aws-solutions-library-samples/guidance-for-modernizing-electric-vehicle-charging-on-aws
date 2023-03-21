FROM amazonlinux:2022

RUN yum update -y
RUN yum groupinstall "Development Tools" -y
RUN yum install openssl-libs -y
RUN yum install python3.10 python3.10-devel -y


RUN mkdir -p /opt/ocpp-gateway
COPY ./ /opt/ocpp-gateway/

RUN python3.10 -m venv /opt/ocpp-gateway/
RUN . /opt/ocpp-gateway/bin/activate && pip install -r /opt/ocpp-gateway/requirements.txt

EXPOSE 80

ENTRYPOINT /opt/ocpp-gateway/run-server.sh
CMD /opt/ocpp-gateway/run-server.sh
