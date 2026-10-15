import { Module } from '@nestjs/common';
import { ImagesService } from './images.service.js';

// Photo processing and storage (BR-16), on its own so both the website content
// (SiteModule) and the services (ServicesModule) can use it without importing
// each other.
@Module({ providers: [ImagesService], exports: [ImagesService] })
export class ImagesModule {}
