// src/modules/users/repositories/refresh-token.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';

@Injectable()
export class RefreshTokenRepository {
  private readonly repo: Repository<RefreshToken>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(RefreshToken);
  }

  async create(data: Partial<RefreshToken>): Promise<RefreshToken> {
    const token = this.repo.create(data);
    return this.repo.save(token);
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.repo.findOne({ where: { tokenHash } });
  }

  async markRevoked(id: string, replacedByTokenId?: string): Promise<void> {
    await this.repo.update(
      { id },
      { revokedAt: new Date(), replacedByTokenId: replacedByTokenId ?? null },
    );
  }

  // Reuse-detection response: a stolen-then-rotated token was replayed
  // — kill every token in its family so the attacker's rotated copy
  // and the legitimate rotated copy both stop working immediately.
  async revokeFamily(familyId: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: new Date() })
      .where('family_id = :familyId', { familyId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  async findActiveByUser(userId: string): Promise<RefreshToken[]> {
    return this.repo
      .createQueryBuilder('rt')
      .where('rt.userId = :userId', { userId })
      .andWhere('rt.revokedAt IS NULL')
      .andWhere('rt.expiresAt > NOW()')
      .orderBy('rt.createdAt', 'DESC')
      .getMany();
  }
}
