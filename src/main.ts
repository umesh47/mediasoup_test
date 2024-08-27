import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SocketIOAdapter } from './socket.adaptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const socketIOAdapter = new SocketIOAdapter(app);

  await socketIOAdapter.connectToRedis();

  app.useWebSocketAdapter(socketIOAdapter);

  await app.listen(3000);
}
bootstrap();
