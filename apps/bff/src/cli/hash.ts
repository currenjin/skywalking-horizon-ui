/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { stdin } from 'node:process';
import argon2 from 'argon2';

async function readPassword(): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => (buf += chunk));
    stdin.on('end', () => resolve(buf.replace(/\r?\n$/, '')));
  });
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const password = arg ?? (await readPassword());
  if (!password) {
    process.stderr.write('usage: hash <password> | echo <password> | hash\n');
    process.exit(1);
  }
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  process.stdout.write(hash + '\n');
}

main().catch((err) => {
  process.stderr.write(`hash failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
