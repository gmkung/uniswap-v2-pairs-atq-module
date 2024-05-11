import fetch from "node-fetch";
import { ContractTag, ITagService } from "atq-types";

const SUBGRAPH_URLS: Record<string, { decentralized: string }> = {
  // Ethereum Mainnet
  "1": {
    decentralized:
      "https://gateway-arbitrum.network.thegraph.com/api/[api-key]/deployments/id/QmZzsQGDmQFbzYkv2qx4pVnD6aVnuhKbD3t1ea7SAvV7zE", // Ethereum deployment, by Uniswap team
  },
};
interface Pair {
  id: string;
  createdAtTimestamp: number;
  token0: Token;
  token1: Token;
}

interface GraphQLData {
  pairs: Pair[];
}

interface GraphQLResponse {
  data?: GraphQLData;
  errors?: { message: string }[]; // Assuming the API might return errors in this format
}
//defining headers for query
const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

const GET_POOLS_QUERY = `
query GetPools($lastTimestamp: Int) {
  pairs(
    first: 1000,
    orderBy: createdAtTimestamp,
    orderDirection: asc,
    where: { createdAtTimestamp_gt: $lastTimestamp }
  ) {
    id
    createdAtTimestamp
    token0 {
      id
      name
      symbol
    }
    token1 {
      id
      name
      symbol
    }
  }
}
`;

function isError(e: unknown): e is Error {
  return (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as Error).message === "string"
  );
}

function containsHtmlOrMarkdown(text: string): boolean {
  // Simple HTML tag detection
  if (/<[^>]*>/.test(text)) {
    return true;
  }
  return false;
}

async function fetchData(
  subgraphUrl: string,
  lastTimestamp: number
): Promise<Pair[]> {
  const response = await fetch(subgraphUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: GET_POOLS_QUERY,
      variables: { lastTimestamp },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const result = (await response.json()) as GraphQLResponse;
  if (result.errors) {
    result.errors.forEach((error) => {
      console.error(`GraphQL error: ${error.message}`);
    });
    throw new Error("GraphQL errors occurred: see logs for details.");
  }

  if (!result.data || !result.data.pairs) {
    throw new Error("No pairs data found.");
  }

  return result.data.pairs;
}

function prepareUrl(chainId: string, apiKey: string): string {
  const urls = SUBGRAPH_URLS[chainId];
  if (!urls || isNaN(Number(chainId))) {
    const supportedChainIds = Object.keys(SUBGRAPH_URLS).join(", ");

    throw new Error(
      `Unsupported or invalid Chain ID provided: ${chainId}. Only the following values are accepted: ${supportedChainIds}`
    );
  }
  return urls.decentralized.replace("[api-key]", encodeURIComponent(apiKey));
}

function truncateString(text: string, maxLength: number) {
  if (text.length > maxLength) {
    return text.substring(0, maxLength - 3) + "..."; // Subtract 3 for the ellipsis
  }
  return text;
}

// Local helper function used by returnTags
interface Token {
  id: string;
  name: string;
  symbol: string;
}

function transformPairsToTags(chainId: string, pairs: Pair[]): ContractTag[] {
  // First, filter and log invalid entries
  const validPairs: Pair[] = [];
  const rejectedNames: string[] = [];

  pairs.forEach((pair) => {
    const token0Invalid =
      containsHtmlOrMarkdown(pair.token0.name) ||
      containsHtmlOrMarkdown(pair.token0.symbol);
    const token1Invalid =
      containsHtmlOrMarkdown(pair.token1.name) ||
      containsHtmlOrMarkdown(pair.token1.symbol);

    if (token0Invalid || token1Invalid) {
      if (token0Invalid) {
        rejectedNames.push(
          pair.token0.name + ", Symbol: " + pair.token0.symbol
        );
      }
      if (token1Invalid) {
        rejectedNames.push(
          pair.token1.name + ", Symbol: " + pair.token1.symbol
        );
      }
    } else {
      validPairs.push(pair);
    }
  });

  // Log all rejected names
  if (rejectedNames.length > 0) {
    console.log(
      "Rejected token names due to HTML/Markdown content:",
      rejectedNames
    );
  }

  // Process valid pair into tags
  return validPairs.map((pair) => {
    const maxSymbolsLength = 45;
    const symbolsText = `${pair.token0.symbol.trim()}/${pair.token1.symbol.trim()}`;
    const truncatedSymbolsText = truncateString(symbolsText, maxSymbolsLength);

    return {
      "Contract Address": `eip155:${chainId}:${pair.id}`,
      "Public Name Tag": `${truncatedSymbolsText} Pair`,
      "Project Name": "Uniswap v2",
      "UI/Website Link": "https://uniswap.org",
      "Public Note": `The pair contract on Uniswap v2 for the ${pair.token0.name
        .replace("USD//C", "USDC")
        .trim()} (${pair.token0.symbol.trim()}) / ${pair.token1.name
        .replace("USD//C", "USDC")
        .trim()} (${pair.token1.symbol.trim()}) pair.`,
    };
  });
}

//The main logic for this module
class TagService implements ITagService {
  // Using an arrow function for returnTags
  returnTags = async (
    chainId: string,
    apiKey: string
  ): Promise<ContractTag[]> => {
    let lastTimestamp: number = 0;
    let allTags: ContractTag[] = [];
    let isMore = true;
    let counter = 0;
    const url = prepareUrl(chainId, apiKey);

    while (isMore) {
      try {
        const pairs = await fetchData(url, lastTimestamp);
        allTags.push(...transformPairsToTags(chainId, pairs));
        counter++;
        console.log(`Retrieved first ${counter * 1000} entries...`);

        isMore = pairs.length === 1000;
        if (isMore) {
          lastTimestamp = parseInt(
            pairs[pairs.length - 1].createdAtTimestamp.toString(),
            10
          );
        }
      } catch (error) {
        if (isError(error)) {
          console.error(`An error occurred: ${error.message}`);
          throw new Error(`Failed fetching data: ${error}`); // Propagate a new error with more context
        } else {
          console.error("An unknown error occurred.");
          throw new Error("An unknown error occurred during fetch operation."); // Throw with a generic error message if the error type is unknown
        }
      }
    }
    return allTags;
  };
}

// Creating an instance of TagService
const tagService = new TagService();

// Exporting the returnTags method directly
export const returnTags = tagService.returnTags;
