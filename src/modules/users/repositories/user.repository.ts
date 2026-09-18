// src/modules/users/repositories/user.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UserRepository {
  private readonly repo: Repository<User>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(User);
  }

  // The only lookup that selects password_hash — used exclusively by
  // the login flow. Every other read must go through findById/findAll
  // below, which never touch the hash (select: false on the column).
  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email })
      .getOne();
  }

  async findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findAll(): Promise<User[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async create(data: Partial<User>): Promise<User> {
    const user = this.repo.create(data);
    return this.repo.save(user);
  }

  async update(id: string, data: Partial<User>): Promise<void> {
    await this.repo.update({ id }, data);
  }

  async recordLoginSuccess(id: string): Promise<void> {
    await this.repo.update(
      { id },
      { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    );
  }

  async recordLoginFailure(
    id: string,
    failedLoginCount: number,
    lockedUntil: Date | null,
  ): Promise<void> {
    await this.repo.update({ id }, { failedLoginCount, lockedUntil });
  }
}
