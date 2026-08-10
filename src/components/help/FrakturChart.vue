<script setup>
const lowercaseChars = [
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    'æ', 'ø'
];
const uppercaseChars = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    'Æ', 'Ø'
];

</script>
<template>
    <div class="rounded border-b-2 border-brand-200 bg-brand-50 p-2 text-brand-600">
       <table class="">
            <thead>
                <tr>
                    <th class="px-2 py-1 text-left">Character</th>
                    <th class="px-2 py-1 text-left">Lowercase</th>
                    <th class="px-2 py-1 text-left">Uppercase</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(lowerChar, index) in lowercaseChars" :key="index">
                    <td class="px-2 py-1 text-5x-l">{{ lowerChar }}</td>
                    <td class="px-2 py-1 font-fraktur text-5x-l">{{ lowerChar }}</td>
                    <td class="px-2 py-1 font-fraktur text-5x-l">{{ uppercaseChars[index] }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>