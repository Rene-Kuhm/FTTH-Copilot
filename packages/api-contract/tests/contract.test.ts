import { describe, expect, it } from 'vitest';
import {
  ChatRequestSchema,
  CreateIncidentRequestSchema,
  CreateUserRequestSchema,
  FeedbackRequestSchema,
  LoginRequestSchema,
  RoleSchema,
  type ChatRequest,
  type CreateIncidentRequest,
} from '../src/index';

/**
 * El contrato es la fuente única de verdad de la API: los validadores que se
 * generan desde él tienen que rechazar exactamente lo que el contrato dice que
 * se rechaza. Estos tests son el que prueba que la generación no se quedó a
 * mitad de camino.
 */
describe('validadores generados desde el contrato', () => {
  it('acepta un body de chat válido', () => {
    const parsed = ChatRequestSchema.parse({ message: '¿cómo está la ONU-342?' });
    expect(parsed.message).toBe('¿cómo está la ONU-342?');
  });

  it('rechaza un mensaje vacío y uno más largo que el máximo', () => {
    expect(ChatRequestSchema.safeParse({ message: '' }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ message: 'x'.repeat(8001) }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ message: 'x'.repeat(8000) }).success).toBe(true);
  });

  it('hace opcionales los campos opcionales del chat', () => {
    expect(ChatRequestSchema.safeParse({ message: 'hola' }).success).toBe(true);
    expect(ChatRequestSchema.safeParse({}).success).toBe(false);
  });

  it('aplica el default de severidad al crear un incidente', () => {
    const parsed = CreateIncidentRequestSchema.parse({
      deviceKind: 'OLT',
      deviceId: 'OLT-01',
      title: 'Corte de fibra',
    });
    expect(parsed.severity).toBe('warning');
  });

  it('rechaza un deviceKind fuera del enum del contrato', () => {
    const result = CreateIncidentRequestSchema.safeParse({
      deviceKind: 'ROUTER',
      deviceId: 'R-01',
      title: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('exige email y contraseña en el login', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ email: 'a@b.com' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ email: 'no-es-un-email', password: 'x' }).success).toBe(
      false,
    );
  });

  it('exige una contraseña de al menos 8 caracteres al crear un usuario', () => {
    expect(
      CreateUserRequestSchema.safeParse({
        email: 'a@b.com',
        password: 'corta',
        role: 'OPERATOR',
      }).success,
    ).toBe(false);
    expect(
      CreateUserRequestSchema.safeParse({
        email: 'a@b.com',
        password: 'larga-suficiente',
        role: 'OPERATOR',
      }).success,
    ).toBe(true);
  });

  it('cierra el enum de roles', () => {
    expect(RoleSchema.safeParse('OWNER').success).toBe(true);
    expect(RoleSchema.safeParse('SUPERUSER').success).toBe(false);
  });

  it('exige una etiqueta de feedback del contrato', () => {
    expect(FeedbackRequestSchema.safeParse({ label: 'confirmed' }).success).toBe(true);
    expect(FeedbackRequestSchema.safeParse({ label: 'tal_vez' }).success).toBe(false);
  });

  it('los tipos generados son usables por el consumidor', () => {
    const chat: ChatRequest = { message: 'hola', conversationId: 'c-1' };
    const incident: CreateIncidentRequest = {
      deviceKind: 'ONU',
      deviceId: 'ONU-1',
      title: 'Caída',
    };
    expect(ChatRequestSchema.parse(chat).message).toBe('hola');
    expect(CreateIncidentRequestSchema.parse(incident).deviceKind).toBe('ONU');
  });
});
