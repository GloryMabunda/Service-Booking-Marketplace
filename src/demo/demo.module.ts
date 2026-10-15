import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { DemoController } from './demo.controller.js';

// The demo mailbox page's data (#demo). Harmless outside demo mode: the
// endpoint answers 404 there.
@Module({ imports: [NotificationsModule], controllers: [DemoController] })
export class DemoModule {}
