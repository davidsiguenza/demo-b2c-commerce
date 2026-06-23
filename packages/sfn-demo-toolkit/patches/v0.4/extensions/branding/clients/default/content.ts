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
import type { BrandContent } from '../../types';

const content: BrandContent = {
    id: 'default',
    displayName: 'Performer',
    logo: {
        src: '/images/logo.svg',
        alt: 'Home',
    },
    hero: [
        {
            id: 'slide-1',
            title: 'The New Season',
            subtitle:
                'A new collection shaped by contrast, proportion, and modern attitude. Introducing key pieces for the season ahead.',
            imageUrl: '/images/hero-01.webp',
            imageAlt: "Women's Slacks Jackets and Purses",
            ctaText: 'Discover the Collection',
            ctaLink: '/category/root',
        },
        {
            id: 'slide-2',
            title: 'The Modern Wardrobe',
            subtitle:
                'Elevated silhouettes, refined textures, and a bold approach to everyday dressing. Designed to move with you.',
            imageUrl: '/images/hero-02.webp',
            imageAlt: "Women's White Linen Dress",
            ctaText: 'Shop the Look',
            ctaLink: '/category/root',
        },
        {
            id: 'slide-3',
            title: 'After Hours',
            subtitle:
                'Statement pieces and refined layers designed for nights out, late moments, and everything in between.',
            imageUrl: '/images/hero-03.webp',
            imageAlt: "Women's Black Suit",
            ctaText: 'Explore the Collection',
            ctaLink: '/category/root',
        },
        {
            id: 'slide-4',
            title: 'New Perspectives',
            subtitle:
                'A curated drop of standout pieces that redefine contemporary fashion. Confident. Expressive. Uncompromising.',
            imageUrl: '/images/hero-04.webp',
            imageAlt: "Women's Grey Dress",
            ctaText: 'Shop Now',
            ctaLink: '/category/root',
        },
    ],
    featuredCards: {
        primary: [
            {
                title: 'Women',
                description:
                    'Discover our curated collection of sophisticated footwear designed for the modern woman.',
                imageUrl: '/images/hero-03.webp',
                imageAlt: "Women's Collection",
                ctaText: 'EXPLORE COLLECTION',
                ctaLink: '/category/womens',
            },
            {
                title: 'Men',
                description:
                    "Timeless craftsmanship meets contemporary style in our men's footwear collection.",
                imageUrl: '/images/hero-04.webp',
                imageAlt: "Men's Collection",
                ctaText: 'EXPLORE COLLECTION',
                ctaLink: '/category/mens',
            },
        ],
        textOnly: {
            title: 'Style for Real Life',
            description:
                'At Market Street, we believe fashion should be effortless, authentic, and accessible. Our collections are designed for the modern individual who values quality, versatility, and timeless style.\n\nDiscover pieces that move with you, adapt to your life, and become the foundation of a wardrobe that works—every day, everywhere.',
        },
    },
};

export default content;
