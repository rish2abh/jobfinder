import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as chalk from 'chalk';
import * as cookieParser from 'cookie-parser';
import * as figlet from 'figlet';
import { AppModule } from './app.module';
import { WinstonLoggerService } from './logger/winston-logger.service';

async function bootstrap() {
  console.log(chalk.green('Starting Jobfinder backend...'));

  const app = await NestFactory.create(AppModule);
  const logger = app.get(WinstonLoggerService);
  app.useLogger(logger);

  app.enableCors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
    credentials: true,
  });

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Jobfinder API')
    .setDescription('Jobfinder backend APIs')
    .setVersion('1.0')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, swaggerDocument);

  const port = process.env.PORT || 4000;
  await app.listen(port);
  const baseUrl = `http://localhost:${port}`;
  const swaggerUrl = `${baseUrl}/api-docs`;

  logger.log(`Server listening on ${baseUrl}`, 'Bootstrap');
  logger.log(`Swagger docs available at ${swaggerUrl}`, 'Bootstrap');
  logger.log(chalk.cyan(figlet.textSync('Jobfinder', { horizontalLayout: 'full' })), 'Bootstrap');
}
bootstrap().catch((error) => {
  console.error('Failed to start Jobfinder backend:', error);
  process.exit(1);
});
