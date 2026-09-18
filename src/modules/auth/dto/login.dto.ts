// src/modules/auth/dto/login.dto.ts

import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'ops-admin@payflow.example' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8, format: 'password' })
  @IsString()
  @MinLength(8)
  password!: string;
}
