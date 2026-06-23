/**
 * Copyright 2026 Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import type { BrandContent } from './types';
import defaultContent from './clients/default/content';

const registry: Record<string, BrandContent> = {
    default: defaultContent,
    // sfn-toolkit: register additional clients here, one import per client.
};

export function getBrandContent(clientId: string | undefined): BrandContent {
    if (clientId && registry[clientId]) {
        return registry[clientId];
    }
    return registry.default;
}

export function listBrandClients(): string[] {
    return Object.keys(registry);
}
