import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FileUploadModule } from './file-upload/file-upload.module';
import { LoggerModule } from './logger/logger.module';
import { MailModule } from './mail/mail.module';
import { UsersModule } from './users/users.module';
import { JobsModule } from './jobs/jobs.module';
import { buildRedisConnection } from './mail/bull-redis.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jobfinder'),

    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: buildRedisConnection(configService),
      }),
      inject: [ConfigService],
    }),

    UsersModule,
    FileUploadModule,
    MailModule,
    JobsModule,
    LoggerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
