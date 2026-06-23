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
import type { ReactElement } from 'react';
import ContentCard from '@/components/content-card';
import { useBrand } from '../use-brand';

export default function BrandedFeaturedContent(): ReactElement {
    const brand = useBrand();
    const { primary, textOnly } = brand.featuredCards;

    return (
        <div className="pt-16">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {primary.map((card) => (
                        <ContentCard
                            key={card.title}
                            title={card.title}
                            description={card.description}
                            imageUrl={card.imageUrl}
                            imageAlt={card.imageAlt}
                            buttonText={card.ctaText}
                            buttonLink={card.ctaLink}
                            showBackground={false}
                            showBorder={false}
                            loading="lazy"
                        />
                    ))}
                </div>

                {textOnly ? (
                    <div className="mt-16 max-w-4xl mx-auto layout-gutter text-center">
                        <ContentCard
                            title={textOnly.title}
                            description={textOnly.description}
                            showBackground={false}
                            showBorder={false}
                            cardFooterClassName="items-center text-center p-0"
                            cardDescriptionClassName="text-center"
                            className="[&_h3]:text-3xl [&_h3]:md:text-4xl [&_h3]:font-normal [&_h3]:text-brand-black [&_h3]:mb-6 [&_h3]:tracking-tight [&_p]:text-lg [&_p]:text-brand-gray-700 [&_p]:leading-relaxed [&_p]:font-normal [&_p:last-of-type]:text-base [&_p:last-of-type]:text-brand-gray-600"
                        />
                    </div>
                ) : null}
            </div>
        </div>
    );
}
