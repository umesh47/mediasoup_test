import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import * as mediasoup from 'mediasoup';
import { Server, Socket } from 'socket.io';
// import { types as mediasoupTypes } from "mediasoup";
import {
  MediaKind,
  RtpCapabilities,
  RtpCodecCapability,
  RtpParameters,
} from 'mediasoup-client/lib/RtpParameters';
import {
  AppData,
  Consumer,
  DtlsParameters,
  Producer,
  Router,
  WebRtcTransport,
  WebRtcTransportOptions,
  Worker,
} from 'mediasoup/node/lib/types';

let worker: Worker;
let router: Router;
let producerTransport: WebRtcTransport;
let consumerTransport: WebRtcTransport;
let producer: Producer;
let consumer: Consumer;

const mediaCodecs: RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
];

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });

  console.log(`worker pid ${worker.pid}`);

  worker.on('died', (_error) => {
    // This implies something serious happened, so kill the application
    console.error('mediasoup worker has died');
    setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
  });
  router = await worker.createRouter({ mediaCodecs });
};

// We create a Worker as soon as our application starts
createWorker();

const createWebRtcTransport = async () => {
  try {
    // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
    const webRtcTransport_options: WebRtcTransportOptions = {
      listenIps: [
        {
          ip: '0.0.0.0', // replace with relevant IP address
          announcedIp: '127.0.0.1',
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

    // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
    let transport = await router.createWebRtcTransport(webRtcTransport_options);
    console.log(`transport id: ${transport.id}`);

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        transport.close();
      }
    });

    // transport.on('close', () => {
    //     console.log('transport closed')
    // })

    // send back to the client the following prameters

    return {
      transport,
      data: {
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      },
    };
  } catch (error) {
    console.log(error);
    return {
      transport: null,
      data: {
        params: {
          error: error,
        },
      },
    };
  }
};

@WebSocketGateway()
export class Gateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  constructor() {}
  @WebSocketServer() io: Server;

  afterInit(_server: any) {
    console.log('Initiated');
  }

  handleConnection(client: Socket) {
    const { sockets } = this.io.sockets;

    console.log('Client id', client.id);
    console.log(`Number of connected clients: ${sockets.size}`);
    client.emit('connection-success', {
      socketId: client.id,
    });
  }
  @SubscribeMessage('getRtpCapabilities')
  async handleRtpCapabilities(@ConnectedSocket() _client: Socket) {
    // Client emits a request for RTP Capabilities
    // This event responds to the request
    const rtpCapabilities = router.rtpCapabilities;

    console.log('rtp Capabilities', rtpCapabilities);

    // call callback from the client and send back the rtpCapabilities
    return { rtpCapabilities };
  }

  @SubscribeMessage('createWebRtcTransport')
  async handleCreateWebRtcTransport(
    @ConnectedSocket() client: Socket,
    @MessageBody() { sender }: { sender: string },
  ) {
    // Client emits a request to create server side Transport
    // We need to differentiate between the producer and consumer transports
    console.log(`Is this a sender request? ${sender}`);
    // The client indicates if it is a producer or a consumer
    // if sender is true, indicates a producer else a consumer
    const { data, transport } = await createWebRtcTransport();

    if (transport) {
      if (sender) producerTransport = transport;
      else consumerTransport = transport;
    }

    return data;
  }

  @SubscribeMessage('transport-connect')
  async handleTransportConnect(
    @MessageBody() { dtlsParameters }: { dtlsParameters: DtlsParameters },
  ) {
    console.log('DTLS PARAMS... ', { dtlsParameters });
    await producerTransport.connect({ dtlsParameters });
  }

  @SubscribeMessage('transport-produce')
  async handleTransportProduce(
    @MessageBody()
    {
      kind,
      rtpParameters,
      appData: _,
    }: {
      kind: MediaKind;
      rtpParameters: RtpParameters;
      appData: AppData;
    },
  ) {
    // call produce based on the prameters from the client
    producer = await producerTransport.produce({
      kind,
      rtpParameters,
    });

    console.log('Producer ID: ', producer.id, producer.kind);

    producer.on('transportclose', () => {
      console.log('transport for this producer closed ');
      producer.close();
    });

    // Send back to the client the Producer's id
    return { id: producer.id };
  }

  @SubscribeMessage('transport-recv-connect')
  async handleTransportRecvConnect(
    @MessageBody() { dtlsParameters }: { dtlsParameters: DtlsParameters },
  ) {
    console.log(`DTLS PARAMS: ${dtlsParameters}`);
    await consumerTransport.connect({ dtlsParameters });
  }

  @SubscribeMessage('consume')
  async handleConsume(
    @MessageBody() { rtpCapabilities }: { rtpCapabilities: RtpCapabilities },
  ) {
    try {
      // check if the router can consume the specified producer
      if (
        router.canConsume({
          producerId: producer.id,
          rtpCapabilities,
        })
      ) {
        // transport can now consume and return a consumer
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        });

        consumer.on('transportclose', () => {
          console.log('transport close from consumer');
        });

        consumer.on('producerclose', () => {
          console.log('producer of consumer closed');
        });

        // from the consumer extract the following params
        // to send back to the Client
        const params = {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        };

        // send the parameters to the client
        return { params };
      }
    } catch (error) {
      console.log(error.message);
      return {
        params: {
          error: error,
        },
      };
    }
  }

  @SubscribeMessage('consumer-resume')
  async handleConsumerResume() {
    console.log('consumer resume');
    await consumer.resume();
  }

  handleDisconnect(client: any) {
    console.log(`Client id:${client.id} disconnected`);
  }
}
