import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { ServerOptions } from 'socket.io';

export class SocketIOAdapter extends IoAdapter {
  constructor(private app: INestApplicationContext) {
    super(app);
  }
  private adapterConstructor: ReturnType<typeof createAdapter>;

  async connectToRedis(): Promise<void> {
    const pubClient = createClient({
      socket: {
        host: 'red-cr6s1si3esus73cl3kpg',
        port: 6379,
      },
    });

    const subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    // const cors = { origin: ["http://localhost:3000"] }

    // const optionsWithCorsAndPath = {
    //     ...options,
    //     cors,
    //     // path: "/ws"
    // }

    // const server = super.createIOServer(port, optionsWithCorsAndPath)
    const server = super.createIOServer(port);

    server.adapter(this.adapterConstructor);

    return server;
  }
}
