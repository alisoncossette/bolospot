import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Required for Stripe webhook signature verification
  });

  // Cookie parsing (required for session cookies)
  app.use(cookieParser());

  // Security headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, etc.)
  app.use(helmet({
    contentSecurityPolicy: false, // Let Next.js handle CSP for frontend
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }));

  // Swagger API Documentation
  const config = new DocumentBuilder()
    .setTitle('Bolo API')
    .setDescription('Cross-platform calendar coordination and identity verification API')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .addTag('auth', 'Authentication endpoints')
    .addTag('users', 'User management')
    .addTag('identities', 'Identity verification')
    .addTag('meetings', 'Meeting scheduling')
    .addTag('connections', 'Calendar connections')
    .addTag('availability', 'Availability via API key')
    .addTag('events', 'Unified calendar events')
    .addTag('invitations', 'Meeting invitations')
    .addTag('api-keys', 'API key management')
    .addTag('approvals', 'Approval requests')
    .addTag('contacts', 'Trusted contacts')
    .addTag('health', 'Health check endpoints')
    .build();

  // Global prefix for all routes (must be set before Swagger)
  app.setGlobalPrefix('api');

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // CORS - allow multiple origins
  const allowedOrigins = [
    'http://localhost:3000',
    'https://bolospot.com',
    'https://www.bolospot.com',
  ];

  if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL);
  }

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log(`CORS blocked origin: ${origin}`);
        callback(null, false);
      }
    },
    credentials: true,
  });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const port = process.env.PORT || 8080;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
}

bootstrap();
